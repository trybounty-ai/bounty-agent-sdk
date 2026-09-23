import { BountyWebhookError, type AgentEvent } from "@bounty-ai/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBountyChannel,
  formatBountyEvent,
  type BountyChannelDependencies,
} from "../extension/channels/bounty.js";

const send = vi.fn();
const verify = vi.fn<BountyChannelDependencies["verify"]>();
const channel = createBountyChannel({ verify });

const event: AgentEvent = {
  id: "evt_1",
  version: 1,
  occurredAt: "2026-08-27T00:00:00.000Z",
  agentId: "agent:one",
  subject: { type: "bounty", id: "bounty/two" },
  type: "bounty.available",
  data: { bounty_id: "bounty/two", title: "Research" },
};

const route = channel.routes[0];
if (!route || route.transport !== "http") {
  throw new Error("Bounty webhook route is missing");
}

function request() {
  return new Request("https://agent.example/webhooks/bounty", {
    method: "POST",
    body: "{}",
  });
}

function routeArgs() {
  // SAFETY: The route under test only reads the public `from().send()` seam.
  return {
    from: () => ({ send }),
  } as never;
}

describe("Eve Bounty channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verify.mockResolvedValue(event);
    send.mockResolvedValue({ id: "session_1" });
  });

  it("seeds the session from verified Agent and Bounty identity", async () => {
    const response = await route.handler(request(), routeArgs());

    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledWith(
      [
        "<bounty_event>",
        "type: bounty.available",
        "bounty_id: bounty/two",
        "event_id: evt_1",
        "<data>",
        '{"bounty_id":"bounty/two","title":"Research"}',
        "</data>",
        "</bounty_event>",
      ].join("\n"),
      expect.objectContaining({
        auth: null,
        state: { agentId: "agent:one", bountyId: "bounty/two" },
        title: "Research",
      }),
    );
  });

  it.each([
    ["payload_too_large", 413],
    ["invalid_event", 400],
    ["invalid_signature", 401],
  ] as const)("maps %s to HTTP %s", async (reason, status) => {
    verify.mockRejectedValueOnce(new BountyWebhookError(reason, reason));

    const response = await route.handler(request(), routeArgs());

    expect(response.status).toBe(status);
    expect(send).not.toHaveBeenCalled();
  });
});

const conversationEvent = {
  id: "evt_2",
  version: 1,
  occurredAt: "2026-09-23T00:00:00.000Z",
  agentId: "agent_1",
} as const;

describe("Eve Bounty event messages", () => {
  it("shows a private owner message with its text and files", () => {
    const text = formatBountyEvent({
      ...conversationEvent,
      subject: { type: "message", id: "message_1" },
      type: "work.message.created",
      data: {
        bounty_id: "bounty_1",
        message_id: "message_1",
        message: {
          _id: "message_1",
          bounty_id: "bounty_1",
          claim_id: "claim_1",
          author_type: "user",
          user_id: "user_1",
          content: { type: "text", text: "Please include Q3." },
          parts: [
            { type: "text", text: "Please include Q3." },
            {
              type: "file",
              attachment_id: "file_1",
              filename: "q3.csv",
              content_type: "text/csv",
              size: 120,
            },
          ],
          created_at: 1,
        },
      },
    }, "bounty_1");

    expect(text).toBe([
      "<bounty_message>",
      "audience: private",
      "bounty_id: bounty_1",
      "event_id: evt_2",
      "message_id: message_1",
      "sender_type: bounty_owner",
      "<content>",
      "Please include Q3.",
      "</content>",
      "<attachments>",
      "- q3.csv (text/csv, 120 bytes, attachment_id: file_1)",
      "</attachments>",
      "</bounty_message>",
    ].join("\n"));
  });

  it("shows an owner reply with the comment it answers", () => {
    const author = { type: "bounty_owner" } as const;
    const text = formatBountyEvent({
      ...conversationEvent,
      subject: { type: "bounty", id: "bounty_1" },
      type: "discussion.user_replied",
      data: {
        bounty_id: "bounty_1",
        comment_id: "comment_2",
        parent_comment_id: "comment_1",
        comment: {
          _id: "comment_2",
          parent_comment_id: "comment_1",
          author,
          body: "Use the account timezone.",
          created_at: 2,
          updated_at: 2,
        },
        parent_comment: {
          _id: "comment_1",
          author: {
            type: "agent",
            agent_id: "agent_1",
            name: "Patchwork",
            verified: true,
            rating_average: 5,
          },
          body: "UTC or the account timezone?",
          created_at: 1,
          updated_at: 1,
        },
      },
    }, "bounty_1");

    expect(text).toBe([
      "<bounty_comment>",
      "audience: public",
      "bounty_id: bounty_1",
      "event_id: evt_2",
      "comment_id: comment_2",
      "parent_comment_id: comment_1",
      "sender_type: bounty_owner",
      "<in_reply_to>",
      "UTC or the account timezone?",
      "</in_reply_to>",
      "<content>",
      "Use the account timezone.",
      "</content>",
      "</bounty_comment>",
    ].join("\n"));
  });

  it("points to the right tool when an older event has no content", () => {
    const text = formatBountyEvent({
      ...conversationEvent,
      subject: { type: "message", id: "message_1" },
      type: "work.message.created",
      data: { bounty_id: "bounty_1", message_id: "message_1" },
    }, "bounty_1");

    expect(text).toContain(
      "content: not included in this event; read it with list-work-messages",
    );
    expect(text).not.toContain("<content>");
  });
});
