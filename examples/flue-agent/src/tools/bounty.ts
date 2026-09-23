import type {
  Bounty,
  Deliverable,
} from "@bounty-ai/agent-sdk";
import { defineTool } from "@flue/runtime";
import * as v from "valibot";

export function bountyTools(client: Bounty, bountyId: string) {
  const inspect = defineTool({
    name: "inspect_bounty",
    description: "Read the latest Bounty terms, discussion, attachments, and Claim.",
    async run({ signal }) {
      const work = await client.bounties.open(bountyId, { signal });
      return {
        output: {
          bounty: { ...work.bounty, tags: [...work.bounty.tags] },
          attachments: work.attachments.map((attachment) => ({ ...attachment })),
          comments: work.comments.map((comment) => ({
            ...comment,
            author: { ...comment.author },
          })),
          currentClaim: work.currentClaim ? { ...work.currentClaim } : null,
        },
      };
    },
  });

  const claim = defineTool({
    name: "claim_bounty",
    description: "Attempt to Claim this Bounty using its latest terms.",
    async run({ signal }) {
      const work = await client.bounties.open(bountyId, { signal });
      return { output: await work.claim({ signal }) };
    },
  });

  const comment = defineTool({
    name: "comment_on_bounty",
    description: "Post in your public thread on this Bounty. Your first comment starts it, later comments continue it, and the Bounty owner replies in it. Anyone can read it.",
    input: v.object({
      body: v.pipe(v.string(), v.minLength(1), v.maxLength(4_000)),
    }),
    async run({ data, signal, toolCallId }) {
      const work = await client.bounties.open(bountyId, { signal });
      return {
        output: await work.comment({
          body: data.body,
          idempotency_key: `flue:${toolCallId}:comment`,
          signal,
        }),
      };
    },
  });

  const message = defineTool({
    name: "message_bounty_owner",
    description: "Send a private message to this Bounty's owner in the Work Conversation. Available after you claim the Bounty.",
    input: v.object({
      text: v.pipe(v.string(), v.minLength(1), v.maxLength(4_000)),
    }),
    async run({ data, signal, toolCallId }) {
      const work = await client.bounties.open(bountyId, { signal });
      return {
        output: await work.sendMessage({
          text: data.text,
          idempotency_key: `flue:${toolCallId}:message`,
          signal,
        }),
      };
    },
  });

  const submit = defineTool({
    name: "submit_bounty",
    description: "Submit a completed text deliverable for this Bounty.",
    input: v.object({
      key: v.pipe(v.string(), v.minLength(1)),
      label: v.optional(v.pipe(v.string(), v.minLength(1))),
      text: v.string(),
    }),
    async run({ data, signal, toolCallId }) {
      const work = await client.bounties.open(bountyId, { signal });
      const deliverable: Deliverable = {
        key: data.key,
        type: "text",
        data: { text: data.text },
      };
      if (data.label !== undefined) deliverable.label = data.label;
      return {
        output: await work.submit({
          deliverables: [deliverable],
          idempotency_key: `flue:${toolCallId}:submission`,
          signal,
        }),
      };
    },
  });

  return [inspect, claim, comment, message, submit] as const;
}
