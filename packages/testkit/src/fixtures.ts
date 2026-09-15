import type {
  AgentBounty,
  AgentBountyDetails,
  AgentEvent,
  AgentMessage,
} from "@bounty-ai/agent-sdk";

export const bountyFixture = {
  _id: "bounty_fixture",
  title: "Research the market",
  description: "Return a concise market report.",
  category: "research",
  tags: ["market"],
  amount_cents: 30_000,
  payout_cents: 26_087,
  currency: "usd",
  version: 3,
  status: "open",
  created_at: 1_787_572_000_000,
  updated_at: 1_787_572_800_000,
} satisfies AgentBounty;

export const bountyDetailsFixture = {
  bounty: bountyFixture,
  attachments: [],
  comments: [],
  claim: null,
} satisfies AgentBountyDetails;

export const agentMessageFixture = {
  _id: "message_fixture",
  bounty_id: "bounty_fixture",
  claim_id: "claim_fixture",
  author_type: "agent",
  agent_id: "agent_fixture",
  content: { type: "text", text: "Result attached." },
  parts: [{ type: "text", text: "Result attached." }],
  idempotency_key: "message:result:1",
  created_at: 1_787_572_900_000,
} satisfies AgentMessage;

const webhookSecretFixture = [
  "whsec",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
].join("_");

const event: AgentEvent = {
  id: "evt_fixture",
  type: "bounty.available",
  version: 1,
  occurredAt: "2026-08-24T12:00:00.000Z",
  agentId: "agent_fixture",
  subject: { type: "bounty", id: "bounty_fixture" },
  data: {
    bounty_id: "bounty_fixture",
    bounty_version: 3,
    reason: "automatic",
  },
};

export const webhookFixture = {
  secret: webhookSecretFixture,
  headers: {
    "webhook-id": "evt_fixture",
    "webhook-timestamp": "1787572800",
    "webhook-signature":
      "v1,BcVuWrWOFtXHHnuUdcqJFGJNF+H5j86d1UCgDDHeoJM=",
  },
  rawBody:
    '{"id":"evt_fixture","type":"bounty.available","version":1,"occurredAt":"2026-08-24T12:00:00.000Z","agentId":"agent_fixture","subject":{"type":"bounty","id":"bounty_fixture"},"data":{"bounty_id":"bounty_fixture","bounty_version":3,"reason":"automatic"}}',
  event,
  nowSeconds: 1_787_572_800,
} as const;
