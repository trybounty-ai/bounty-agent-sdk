import {
  BountyWebhookError,
  getBountyId,
  isAgentEvent,
  type AgentEvent,
  type AgentMessage,
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

export interface BountyChannelDependencies {
  verify(request: Request): Promise<AgentEvent>;
}

const defaultDependencies: BountyChannelDependencies = {
  verify: (request) => bountyClient().webhooks.verify(request),
};

function formatBlock(
  tag: string,
  fields: ReadonlyArray<readonly [string, string]>,
  sections: ReadonlyArray<readonly [string, string]>,
) {
  return [
    `<${tag}>`,
    ...fields.map(([key, value]) => `${key}: ${value}`),
    ...sections.flatMap(([section, body]) => [`<${section}>`, body, `</${section}>`]),
    `</${tag}>`,
  ].join("\n");
}

function messageSections(message: AgentMessage) {
  const text = message.parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n\n");
  const files = message.parts.flatMap((part) =>
    part.type === "file"
      ? [`- ${part.filename} (${part.content_type}, ${part.size} bytes, attachment_id: ${part.attachment_id})`]
      : []
  );
  return [
    ...(text ? [["content", text] as const] : []),
    ...(files.length > 0 ? [["attachments", files.join("\n")] as const] : []),
  ];
}

export function formatBountyEvent(event: AgentEvent, bountyId: string) {
  if (isAgentEvent(event, "work.message.created")) {
    const { message } = event.data;
    return formatBlock(
      "bounty_message",
      [
        ["audience", "private"],
        ["bounty_id", bountyId],
        ["event_id", event.id],
        ["message_id", event.data.message_id],
        ["sender_type", "bounty_owner"],
        ...(message
          ? []
          : [["content", "not included in this event; read it with list-work-messages"] as const]),
      ],
      message ? messageSections(message) : [],
    );
  }
  if (isAgentEvent(event, "discussion.user_replied")) {
    const { comment, parent_comment: parentComment } = event.data;
    return formatBlock(
      "bounty_comment",
      [
        ["audience", "public"],
        ["bounty_id", bountyId],
        ["event_id", event.id],
        ["comment_id", event.data.comment_id],
        ...(event.data.parent_comment_id
          ? [["parent_comment_id", event.data.parent_comment_id] as const]
          : []),
        ["sender_type", "bounty_owner"],
        ...(comment
          ? []
          : [["content", "not included in this event; read it with get-bounty"] as const]),
      ],
      [
        ...(parentComment ? [["in_reply_to", parentComment.body] as const] : []),
        ...(comment ? [["content", comment.body] as const] : []),
      ],
    );
  }
  return formatBlock(
    "bounty_event",
    [
      ["type", event.type],
      ["bounty_id", bountyId],
      ["event_id", event.id],
    ],
    [["data", JSON.stringify(event.data)]],
  );
}

export function createBountyChannel(
  dependencies: BountyChannelDependencies = defaultDependencies,
) {
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

          const address = [
            "agent",
            encodeURIComponent(event.agentId),
            "bounty",
            encodeURIComponent(bountyId),
          ].join(":");
          const parsedTitle = eventTitleSchema.safeParse(event.data.title);
          const session = await from(address).send(
            formatBountyEvent(event, bountyId),
            {
              auth: null,
              state: { agentId: event.agentId, bountyId },
              title: parsedTitle.success
                ? parsedTitle.data
                : `Bounty ${bountyId}`,
            },
          );

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
