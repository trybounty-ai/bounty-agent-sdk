import {
  BountyWebhookError,
  formatAgentEvent,
  type AgentEvent,
} from "@bounty-ai/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBountyChannel,
  createBountyFetchFile,
  type BountyChannelDependencies,
} from "../extension/channels/bounty.js";

const send = vi.fn();
const verify = vi.fn<BountyChannelDependencies["verify"]>();
const downloadMessageFile = vi.fn<BountyChannelDependencies["downloadMessageFile"]>();

const event: AgentEvent = {
  id: "evt_1",
  version: 1,
  occurredAt: "2026-08-27T00:00:00.000Z",
  agentId: "agent:one",
  subject: { type: "bounty", id: "bounty/two" },
  type: "bounty.available",
  data: { bounty_id: "bounty/two", title: "Research" },
};

const messageEvent: AgentEvent = {
  id: "evt_2",
  version: 1,
  occurredAt: "2026-09-23T00:00:00.000Z",
  agentId: "agent:one",
  subject: { type: "message", id: "message/1" },
  type: "work.message.created",
  data: {
    bounty_id: "bounty/two",
    message_id: "message/1",
    message: {
      _id: "message/1",
      bounty_id: "bounty/two",
      claim_id: "claim_1",
      author_type: "user",
      user_id: "user_1",
      content: { type: "text", text: "Please include Q3." },
      parts: [
        { type: "text", text: "Please include Q3." },
        {
          type: "file",
          attachment_id: "file/1",
          filename: "q3.csv",
          content_type: "text/csv",
          size: 12,
        },
      ],
      created_at: 1,
    },
  },
};

function channelUnderTest() {
  const channel = createBountyChannel({ verify, downloadMessageFile });
  const route = channel.routes[0];
  if (!route || route.transport !== "http") {
    throw new Error("Bounty webhook route is missing");
  }
  return { route };
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

  it("sends the formatted event and seeds the session from verified identity", async () => {
    const { route } = channelUnderTest();
    const response = await route.handler(request(), routeArgs());

    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledWith(
      formatAgentEvent(event),
      expect.objectContaining({
        auth: null,
        state: { agentId: "agent:one", bountyId: "bounty/two" },
        title: "Research",
      }),
    );
  });

  it("attaches owner files to the turn as Bounty file parts", async () => {
    verify.mockResolvedValue(messageEvent);
    const { route } = channelUnderTest();

    await route.handler(request(), routeArgs());

    expect(send).toHaveBeenCalledWith(
      [
        { type: "text", text: formatAgentEvent(messageEvent) },
        {
          type: "file",
          data: new URL("bounty-file:message%2F1/file%2F1"),
          filename: "q3.csv",
          mediaType: "text/csv",
        },
      ],
      expect.anything(),
    );
  });

  it("downloads Bounty file URLs with the SDK and ignores other URLs", async () => {
    downloadMessageFile.mockResolvedValue(new Response("name,value\n", {
      headers: { "content-type": "text/csv" },
    }));
    const fetchFile = createBountyFetchFile(downloadMessageFile);

    const file = await fetchFile("bounty-file:message%2F1/file%2F1");

    expect(downloadMessageFile).toHaveBeenCalledWith("message/1", "file/1");
    expect(file).toEqual({
      bytes: Buffer.from("name,value\n"),
      mediaType: "text/csv",
    });
    expect(await fetchFile("https://example.com/file.csv")).toBeNull();
  });

  it("skips a redelivered event after it was accepted", async () => {
    const { route } = channelUnderTest();

    await route.handler(request(), routeArgs());
    const duplicate = await route.handler(request(), routeArgs());

    expect(send).toHaveBeenCalledOnce();
    expect(await duplicate.json()).toEqual({ accepted: true, duplicate: true });
  });

  it("accepts a redelivery when the first attempt failed", async () => {
    send.mockRejectedValueOnce(new Error("runtime unavailable"));
    const { route } = channelUnderTest();

    await expect(route.handler(request(), routeArgs())).rejects.toThrow(
      "runtime unavailable",
    );
    const retry = await route.handler(request(), routeArgs());

    expect(retry.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["payload_too_large", 413],
    ["invalid_event", 400],
    ["invalid_signature", 401],
  ] as const)("maps %s to HTTP %s", async (reason, status) => {
    verify.mockRejectedValueOnce(new BountyWebhookError(reason, reason));
    const { route } = channelUnderTest();

    const response = await route.handler(request(), routeArgs());

    expect(response.status).toBe(status);
    expect(send).not.toHaveBeenCalled();
  });
});
