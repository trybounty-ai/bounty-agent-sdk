import {
  BountyWebhookError,
  formatAgentEvent,
  getBountyId,
  isAgentEvent,
  type AgentEvent,
  type CallOptions,
} from "@bounty-ai/agent-sdk";
import { defineChannel, POST } from "eve/channels";
import { z } from "zod";

import { bountyClient } from "../lib/bounty.js";

interface BountyChannelState {
  agentId: string;
  bountyId: string;
}

export type BountyChannelContext = Record<keyof BountyChannelState, string>;

const eventTitleSchema = z.string().min(1);
const BOUNTY_FILE_URL_PROTOCOL = "bounty-file:";
const MAX_HANDLED_EVENTS = 10_000;

export interface BountyChannelDependencies {
  verify(request: Request): Promise<AgentEvent>;
  downloadMessageFile(
    messageId: string,
    attachmentId: string,
    options?: CallOptions,
  ): Promise<Response>;
}

const defaultDependencies: BountyChannelDependencies = {
  verify: (request) => bountyClient().webhooks.verify(request),
  downloadMessageFile: (messageId, attachmentId, options) =>
    bountyClient().attachments.downloadMessageFile(messageId, attachmentId, options),
};

// Owner files travel as `bounty-file:` URLs so Eve stages them into the
// session sandbox through `fetchFile`, which holds the Bounty API key.
function bountyFileUrl(messageId: string, attachmentId: string) {
  return new URL(
    `${BOUNTY_FILE_URL_PROTOCOL}${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`,
  );
}

function parseBountyFileUrl(value: string) {
  if (!value.startsWith(BOUNTY_FILE_URL_PROTOCOL)) return null;
  const [messageId, attachmentId, ...rest] = value
    .slice(BOUNTY_FILE_URL_PROTOCOL.length)
    .split("/");
  if (!messageId || !attachmentId || rest.length > 0) return null;
  return {
    messageId: decodeURIComponent(messageId),
    attachmentId: decodeURIComponent(attachmentId),
  };
}

export function createBountyFetchFile(
  downloadMessageFile: BountyChannelDependencies["downloadMessageFile"],
) {
  return async (url: string) => {
    const file = parseBountyFileUrl(url);
    if (!file) return null;
    const response = await downloadMessageFile(file.messageId, file.attachmentId);
    if (!response.ok) {
      throw new Error(`Bounty file download returned HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const mediaType = response.headers.get("content-type");
    return mediaType ? { bytes, mediaType } : { bytes };
  };
}

function turnMessage(event: AgentEvent) {
  const text = formatAgentEvent(event);
  if (!isAgentEvent(event, "work.message.created") || !event.data.message) {
    return text;
  }
  const messageId = event.data.message_id;
  const files = event.data.message.parts.flatMap((part) =>
    part.type === "file"
      ? [{
          type: "file" as const,
          data: bountyFileUrl(messageId, part.attachment_id),
          filename: part.filename,
          mediaType: part.content_type,
        }]
      : []
  );
  return files.length === 0 ? text : [{ type: "text" as const, text }, ...files];
}

export function createBountyChannel(
  dependencies: BountyChannelDependencies = defaultDependencies,
) {
  // Like Eve's Slack channel, skip redeliveries this instance already
  // accepted. This is best-effort; it does not span server instances.
  const handledEventIds = new Set<string>();

  return defineChannel<
    BountyChannelState,
    void,
    BountyChannelContext,
    BountyChannelContext
  >({
    state: {
      agentId: "",
      bountyId: "",
    },
    metadata: ({ agentId, bountyId }) => ({ agentId, bountyId }),
    fetchFile: createBountyFetchFile(dependencies.downloadMessageFile),
    routes: [
      POST("/webhooks/bounty", async (request, { from }) => {
        try {
          const event = await dependencies.verify(request);
          const bountyId = getBountyId(event);

          if (!bountyId) {
            return Response.json(
              { accepted: true, ignored: true },
              { status: 202 },
            );
          }
          if (handledEventIds.has(event.id)) {
            return Response.json(
              { accepted: true, duplicate: true },
              { status: 202 },
            );
          }
          handledEventIds.add(event.id);
          if (handledEventIds.size > MAX_HANDLED_EVENTS) {
            for (const eventId of handledEventIds) {
              if (handledEventIds.size <= MAX_HANDLED_EVENTS / 2) break;
              handledEventIds.delete(eventId);
            }
          }

          const address = [
            "agent",
            encodeURIComponent(event.agentId),
            "bounty",
            encodeURIComponent(bountyId),
          ].join(":");
          const parsedTitle = eventTitleSchema.safeParse(event.data.title);
          let session;
          try {
            session = await from(address).send(turnMessage(event), {
              auth: null,
              state: { agentId: event.agentId, bountyId },
              title: parsedTitle.success
                ? parsedTitle.data
                : `Bounty ${bountyId}`,
            });
          } catch (error) {
            handledEventIds.delete(event.id);
            throw error;
          }

          return Response.json({ accepted: true, sessionId: session.id }, {
            status: 202,
          });
        } catch (error) {
          if (error instanceof BountyWebhookError) {
            const status = error.reason === "payload_too_large"
              ? 413
              : error.reason === "invalid_signature" ||
                  error.reason === "invalid_signature_format" ||
                  error.reason === "timestamp_out_of_tolerance"
              ? 401
              : 400;
            return Response.json(
              { error: "invalid_bounty_webhook", reason: error.reason },
              { status },
            );
          }
          throw error;
        }
      }),
    ],
  });
}

export default createBountyChannel();
