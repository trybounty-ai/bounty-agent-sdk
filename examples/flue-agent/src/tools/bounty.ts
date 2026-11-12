import type {
  Bounty,
  Deliverable,
} from "@bounty-ai/agent-sdk";
import { defineTool } from "@flue/runtime";
import * as v from "valibot";

export function bountyTools(client: Bounty, bountyId: string) {
  const inspect = defineTool({
    name: "inspect_bounty",
    description: "Read the latest Bounty terms, discussion, attachments, Claim, your bid, and your add-ons. `bounty.flow` says whether you claim it or bid on it.",
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
          currentBid: work.currentBid ? { ...work.currentBid } : null,
          addOns: work.addOns.map((addOn) => ({ ...addOn })),
        },
      };
    },
  });

  const claim = defineTool({
    name: "claim_bounty",
    description: "Attempt to Claim this claim Bounty using its latest terms. A bid Bounty can't be claimed; use place_bid.",
    async run({ signal }) {
      const work = await client.bounties.open(bountyId, { signal });
      return { output: await work.claim({ signal }) };
    },
  });

  const placeBid = defineTool({
    name: "place_bid",
    description: "Bid on this bid Bounty at its latest terms, replacing your active bid. If the Bounty changes after you bid, your bid becomes stale; inspect it and bid again.",
    input: v.object({
      payout_cents: v.pipe(v.number(), v.integer(), v.minValue(500), v.maxValue(10_000_000)),
      note: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(2_000))),
    }),
    async run({ data, signal, toolCallId }) {
      const work = await client.bounties.open(bountyId, { signal });
      return {
        output: await work.bid({
          payout_cents: data.payout_cents,
          note: data.note,
          idempotency_key: `flue:${toolCallId}:bid`,
          signal,
        }),
      };
    },
  });

  const withdrawBid = defineTool({
    name: "withdraw_bid",
    description: "Withdraw your active bid on this Bounty. Your private thread with the owner stays open.",
    async run({ signal }) {
      const work = await client.bounties.open(bountyId, { signal });
      return { output: await work.withdrawBid({ signal }) };
    },
  });

  const proposeAddOn = defineTool({
    name: "propose_add_on",
    description: "Offer the owner paid extra work on a Bounty you were hired for through a bid, before you submit. One proposal is open at a time; proposing again replaces it. Once the owner pays, your submission must deliver it.",
    input: v.object({
      description: v.pipe(v.string(), v.minLength(1), v.maxLength(2_000)),
      verification: v.pipe(v.string(), v.minLength(1), v.maxLength(2_000)),
      payout_cents: v.pipe(v.number(), v.integer(), v.minValue(500), v.maxValue(10_000_000)),
    }),
    async run({ data, signal, toolCallId }) {
      const work = await client.bounties.open(bountyId, { signal });
      return {
        output: await work.proposeAddOn({
          ...data,
          idempotency_key: `flue:${toolCallId}:add-on`,
          signal,
        }),
      };
    },
  });

  const comment = defineTool({
    name: "comment_on_bounty",
    description: "Post in your public thread on this claim Bounty. Your first comment starts it, later comments continue it, and the Bounty owner replies in it. Anyone can read it. A bid Bounty rejects comments; use message_bounty_owner.",
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
    description: "Send a private message to this Bounty's owner. On a bid Bounty you can message before or after bidding; on a claim Bounty, after you claim it.",
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
    description: "Submit a completed text deliverable for this Bounty, covering every paid add-on.",
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

  return [inspect, claim, placeBid, withdrawBid, proposeAddOn, comment, message, submit] as const;
}
