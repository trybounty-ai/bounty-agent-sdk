import assert from "node:assert/strict";
import Bounty, { BountyApiError } from "../packages/agent-sdk/dist/index.js";

const apiKey = process.env.BOUNTY_AGENT_API_KEY;
const baseURL = process.env.BOUNTY_API_BASE_URL;
if (!apiKey || !baseURL) {
  throw new Error("BOUNTY_AGENT_API_KEY and BOUNTY_API_BASE_URL are required");
}

const bounty = new Bounty({ apiKey, baseURL });

async function drainEvents(cursor) {
  const events = [];
  let nextCursor = cursor;
  while (true) {
    const page = await bounty.events.poll({ cursor: nextCursor, limit: 100 });
    events.push(...page.events);
    nextCursor = page.next_cursor;
    if (!page.has_more) return { events, cursor: nextCursor };
  }
}

const initial = await drainEvents(undefined);
const bounties = [];
for await (const item of bounty.bounties.iterate({ limit: 100 })) bounties.push(item);

const openSummary = bounties.find((item) => item.title === "Sales leader hiring signals");
const rejectionEvent = initial.events.find(
  (event) => event.type === "submission.verification_failed",
);
assert(openSummary, "A fresh workspace open Bounty was not visible to the Agent");
assert(rejectionEvent, "The seeded revision event was not recoverable from the event feed");
assert(rejectionEvent.data.bounty_id, "The revision event did not identify a Bounty");

const openWork = await bounty.bounties.open(openSummary._id);
assert.equal(openWork.bounty.status, "open", "Reset the workspace before running this check");
assert.equal(openWork.bounty.flow, "bid", "The open workspace Bounty should take bids");
assert.equal(openWork.comments.length, 0, "A Bounty that takes bids has no public discussion");

await assert.rejects(
  openWork.comment({
    body: "Live SDK conformance: public comments are closed on a Bounty that takes bids.",
    idempotency_key: "workspace-live:open-comment:v2",
  }),
  (error) => error instanceof BountyApiError && error.code === "COMMENTS_CLOSED",
);

const messageInput = {
  text: "Live SDK conformance: the Agent can ask the owner a private question before bidding.",
  idempotency_key: "workspace-live:open-message:v1",
};
const message = await openWork.sendMessage(messageInput);
const messageReplay = await openWork.sendMessage(messageInput);
assert.equal(messageReplay.message._id, message.message._id);
assert.equal(messageReplay.replayed, true);

const messages = [];
for await (const item of openWork.messages({ limit: 100 })) messages.push(item);
assert(messages.some((item) => item._id === message.message._id));

const bidInput = {
  payout_cents: 2_400,
  note: "Live SDK conformance bid.",
  idempotency_key: "workspace-live:bid:v1",
};
const bid = await openWork.bid(bidInput);
const bidReplay = await openWork.bid(bidInput);
assert.equal(bidReplay.bid.id, bid.bid.id);
assert.equal(bidReplay.replayed, true);

const biddingWork = await openWork.refresh();
assert.equal(biddingWork.currentBid?.id, bid.bid.id);
assert.equal(biddingWork.currentBid?.status, "active");

const rejectedWork = await bounty.bounties.open(rejectionEvent.data.bounty_id);
assert.equal(rejectedWork.bounty.title, "AI engineering podcast research");
assert.equal(rejectedWork.bounty.status, "claimed");
assert(rejectedWork.currentClaim, "Rejected Bounty did not preserve its active Claim");

const revisionInput = {
  deliverables: [
    {
      key: "results",
      type: "text",
      label: "Revised result",
      data: { text: "Every podcast entry now includes a recent episode URL." },
    },
  ],
  idempotency_key: "workspace-live:revision:v2",
};
const revision = await rejectedWork.submit(revisionInput);
const revisionReplay = await rejectedWork.submit(revisionInput);
assert.equal(revision.version, 2);
assert.equal(revisionReplay.submission_id, revision.submission_id);
assert.equal(revisionReplay.replayed, true);

assert(
  initial.events.some(
    (event) => event.type === "bounty.available" && event.data.bounty_id === openSummary._id,
  ),
  "The open Bounty's availability event was absent from recovery",
);

console.log(JSON.stringify({
  agentApi: "passed",
  bountiesVisible: bounties.length,
  publicCommentsClosed: true,
  privateMessageReplay: messageReplay.replayed,
  bidReplay: bidReplay.replayed,
  revisionVersion: revision.version,
  revisionReplay: revisionReplay.replayed,
}, null, 2));
