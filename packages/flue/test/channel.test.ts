import { webhookFixture } from "@bounty-ai/agent-testkit";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBountyChannel,
  InvalidBountyInstanceIdError,
} from "../src/index.js";

describe("createBountyChannel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(webhookFixture.nowSeconds * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("validates channel options eagerly", () => {
    expect(() => createBountyChannel({ webhookSecret: "", webhook() {} }))
      .toThrow("non-empty webhookSecret");
    expect(() =>
      createBountyChannel({
        webhookSecret: webhookFixture.secret,
        bodyLimit: 0,
        webhook() {},
      })
    ).toThrow("bodyLimit");
    expect(() =>
      createBountyChannel({
        webhookSecret: webhookFixture.secret,
        toleranceSeconds: -1,
        webhook() {},
      })
    ).toThrow("toleranceSeconds");
  });

  it("delivers a verified event and derives a stable instance id", async () => {
    const webhook = vi.fn();
    const channel = createBountyChannel({
      webhookSecret: webhookFixture.secret,
      webhook,
    });
    const app = new Hono();
    app.route("/channels/bounty", channel.route());

    const response = await app.request("/channels/bounty/webhook", {
      method: "POST",
      headers: {
        ...webhookFixture.headers,
        "content-type": "application/json",
      },
      body: webhookFixture.rawBody,
    });

    expect(response.status).toBe(200);
    expect(webhook).toHaveBeenCalledWith(expect.objectContaining({
      event: webhookFixture.event,
      deliveryId: webhookFixture.event.id,
      bountyId: "bounty_fixture",
    }));

    const ref = { agentId: "agent:one", bountyId: "bounty/two" };
    expect(channel.parseInstanceId(channel.instanceId(ref))).toEqual(ref);
    expect(() => channel.parseInstanceId("bounty:bad")).toThrow(
      InvalidBountyInstanceIdError,
    );
  });

  it("rejects invalid signatures before calling application code", async () => {
    const webhook = vi.fn();
    const channel = createBountyChannel({
      webhookSecret: webhookFixture.secret,
      webhook,
    });
    const app = new Hono();
    app.route("/channels/bounty", channel.route());

    const response = await app.request("/channels/bounty/webhook", {
      method: "POST",
      headers: {
        ...webhookFixture.headers,
        "content-type": "application/json",
        "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
      body: webhookFixture.rawBody,
    });

    expect(response.status).toBe(401);
    expect(webhook).not.toHaveBeenCalled();
  });
});
