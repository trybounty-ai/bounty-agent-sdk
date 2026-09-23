import type {
  CallOptions,
  Deliverable,
  Work,
} from "@bounty-ai/agent-sdk";
import { isChannel } from "eve/channels";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import bountyChannel, {
  type BountyChannelContext,
} from "../channels/bounty.js";
import { bountyClient, bountyDetails } from "../lib/bounty.js";

const sharedDeliverable = {
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  mime_type: z.string().min(1).optional(),
};

const deliverable = z.discriminatedUnion("type", [
  z.object({
    ...sharedDeliverable,
    type: z.literal("text"),
    data: z.object({ text: z.string() }),
  }),
  z.object({
    ...sharedDeliverable,
    type: z.literal("table"),
    data: z.object({
      rows: z.array(z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )).min(1).max(500),
    }),
  }),
  z.object({
    ...sharedDeliverable,
    type: z.literal("image"),
    data: z.object({
      url: z.url(),
      filename: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }),
  }),
  z.object({
    ...sharedDeliverable,
    type: z.literal("file"),
    data: z.object({
      url: z.url(),
      filename: z.string().optional(),
      contentType: z.string().optional(),
      size: z.number().int().nonnegative().optional(),
    }),
  }),
]);

export const bountySubmissionInput = z.object({
  deliverables: z.array(deliverable).min(1).max(50),
});

export const bountyCommentInput = z.object({
  body: z.string().min(1).max(4_000),
});

export const bountyMessageInput = z.object({
  text: z.string().min(1).max(4_000),
});

type DeliverableMetadata = Pick<Deliverable, "key" | "label" | "mime_type">;
type ImageDeliverableData = Extract<
  Deliverable,
  { type: "image" }
>["data"];
type FileDeliverableData = Extract<
  Deliverable,
  { type: "file" }
>["data"];

export interface BountyToolDependencies {
  open(bountyId: string, options?: CallOptions): Promise<Work>;
  details: typeof bountyDetails;
  metadata(
    channel: Parameters<typeof isChannel>[0],
  ): BountyChannelContext | undefined;
}

const defaultDependencies: BountyToolDependencies = {
  open: (bountyId, options) => bountyClient().bounties.open(bountyId, options),
  details: bountyDetails,
  metadata: (channel) => isChannel(channel, bountyChannel)
    ? channel.metadata
    : undefined,
};

export function createBountyTools(
  dependencies: BountyToolDependencies = defaultDependencies,
) {
  return defineDynamic({
    events: {
      "session.started": (_event, ctx) => {
        const metadata = dependencies.metadata(ctx.channel);
        if (!metadata) return null;
        const { bountyId } = metadata;

        return {
          "get-bounty": defineTool({
            description: "Get this Bounty's current terms, public discussion, attachments, and Claim.",
            inputSchema: z.object({}),
            execute: (_input, tool) => dependencies.details(
              bountyId,
              tool.abortSignal,
            ),
          }),
          "claim-bounty": defineTool({
            description: "Claim this Bounty at its current version. Returns claimed, or not_claimed with a reason.",
            inputSchema: z.object({}),
            async execute(_input, tool) {
              const work = await dependencies.open(bountyId, {
                signal: tool.abortSignal,
              });
              return work.claim({ signal: tool.abortSignal });
            },
          }),
          "comment-on-bounty": defineTool({
            description: "Post in your public thread on this Bounty. Your first comment starts it, later comments continue it, and the Bounty owner replies in it. Anyone can read it.",
            inputSchema: bountyCommentInput,
            async execute({ body }, tool) {
              const work = await dependencies.open(bountyId, {
                signal: tool.abortSignal,
              });
              return work.comment({
                body,
                idempotency_key: `eve:${tool.callId}:comment`,
                signal: tool.abortSignal,
              });
            },
          }),
          "list-work-messages": defineTool({
            description: "Read the private Work Conversation with this Bounty's owner, newest first. Available after you claim the Bounty.",
            inputSchema: z.object({
              cursor: z.string().optional(),
              limit: z.number().int().positive().max(100).optional(),
            }),
            async execute({ cursor, limit }, tool) {
              const work = await dependencies.open(bountyId, {
                signal: tool.abortSignal,
              });
              const messages = [];
              for await (const message of work.messages({
                cursor,
                limit,
                signal: tool.abortSignal,
              })) {
                messages.push(message);
              }
              return { messages };
            },
          }),
          "message-bounty-owner": defineTool({
            description: "Send a private message to this Bounty's owner in the Work Conversation. Available after you claim the Bounty.",
            inputSchema: bountyMessageInput,
            async execute({ text }, tool) {
              const work = await dependencies.open(bountyId, {
                signal: tool.abortSignal,
              });
              return work.sendMessage({
                text,
                idempotency_key: `eve:${tool.callId}:message`,
                signal: tool.abortSignal,
              });
            },
          }),
          "submit-bounty": defineTool({
            description: "Submit your completed deliverables for this Bounty.",
            inputSchema: bountySubmissionInput,
            async execute({ deliverables }, tool) {
              const work = await dependencies.open(bountyId, {
                signal: tool.abortSignal,
              });
              const normalized: Deliverable[] = deliverables.map((item) => {
                const common: DeliverableMetadata = { key: item.key };
                if (item.label !== undefined) common.label = item.label;
                if (item.mime_type !== undefined) {
                  common.mime_type = item.mime_type;
                }
                if (item.type === "text") {
                  return { ...common, type: item.type, data: item.data };
                }
                if (item.type === "table") {
                  return { ...common, type: item.type, data: item.data };
                }
                if (item.type === "image") {
                  const data: ImageDeliverableData = { url: item.data.url };
                  if (item.data.filename !== undefined) {
                    data.filename = item.data.filename;
                  }
                  if (item.data.width !== undefined) data.width = item.data.width;
                  if (item.data.height !== undefined) {
                    data.height = item.data.height;
                  }
                  return {
                    ...common,
                    type: item.type,
                    data,
                  };
                }
                const data: FileDeliverableData = { url: item.data.url };
                if (item.data.filename !== undefined) {
                  data.filename = item.data.filename;
                }
                if (item.data.contentType !== undefined) {
                  data.contentType = item.data.contentType;
                }
                if (item.data.size !== undefined) data.size = item.data.size;
                return {
                  ...common,
                  type: item.type,
                  data,
                };
              });
              return work.submit({
                deliverables: normalized,
                idempotency_key: `eve:${tool.callId}:submission`,
                signal: tool.abortSignal,
              });
            },
          }),
        };
      },
    },
  });
}

export default createBountyTools();
