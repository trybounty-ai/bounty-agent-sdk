import Bounty, {
  BountyApiError,
  BountyConfigurationError,
  BountyInvalidResponseError,
  BountyTimeoutError,
  BountyUploadError,
  BountyWebhookError,
  isAgentEvent,
  verifyWebhook,
  type BountyOptions,
} from "@bounty-ai/agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentApiMock,
  agentMessageFixture,
  bountyDetailsFixture,
  bountyFixture,
  jsonResponse,
  webhookFixture,
} from "../src/index.js";

function createClient(
  api: AgentApiMock,
  options: Partial<BountyOptions> = {},
) {
  return new Bounty({
    apiKey: "agent_key_test",
    baseURL: "https://api.example.test",
    fetch: api.fetch,
    maxRetries: 0,
    ...options,
  });
}

async function signedWebhookRequest(args: {
  rawBody: string | Uint8Array;
  secret?: string;
  webhookId?: string;
  timestamp?: string;
}) {
  const secret = args.secret ?? webhookFixture.secret;
  const webhookId = args.webhookId ?? webhookFixture.event.id;
  const timestamp = args.timestamp ?? webhookFixture.headers["webhook-timestamp"];
  const rawBody = args.rawBody instanceof Uint8Array
    ? args.rawBody
    : new TextEncoder().encode(args.rawBody);
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const binarySecret = atob(encodedSecret);
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(binarySecret, (character) => character.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prefix = new TextEncoder().encode(`${webhookId}.${timestamp}.`);
  const signedBody = new Uint8Array(prefix.byteLength + rawBody.byteLength);
  signedBody.set(prefix);
  signedBody.set(rawBody, prefix.byteLength);
  const signature = await crypto.subtle.sign("HMAC", key, signedBody);
  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  );

  return new Request("https://agent.example.test/webhooks/bounty", {
    method: "POST",
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${encodedSignature}`,
    },
    body: rawBody,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Bounty Agent SDK", () => {
  it("binds the runtime fetch implementation to the global receiver", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/bounties",
      jsonResponse({ bounties: [], next_cursor: "", is_done: true }),
    );
    const runtimeFetch = vi.fn(function (
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      expect(this).toBe(globalThis);
      return api.fetch(input, init);
    });
    vi.stubGlobal("fetch", runtimeFetch);

    const client = new Bounty({
      apiKey: "agent_key_test",
      baseURL: "https://api.example.test",
      maxRetries: 0,
    });
    await client.bounties.list();

    expect(runtimeFetch).toHaveBeenCalledOnce();
    api.assertComplete();
  });

  it("uses a configured client with resource-shaped reads", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/bounties",
      jsonResponse({
        bounties: [bountyFixture],
        next_cursor: "cursor_1",
        is_done: true,
      }),
    );
    const page = await createClient(api).bounties.list({ limit: 5 });

    expect(page.bounties).toEqual([bountyFixture]);
    expect(page.bounties[0]?.payout_cents).toBe(26_087);
    const request = api.calls[0]!.request;
    expect(request.headers.get("authorization")).toBe(
      "Bearer agent_key_test",
    );
    expect(new URL(request.url).searchParams.get("limit")).toBe("5");
    api.assertComplete();
  });

  it("opens current context from an event and claims its loaded version", async () => {
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/claims", () => {
        return jsonResponse({
          outcome: "claimed",
          claim: {
            claim_id: "claim_fixture",
            bounty_id: "bounty_fixture",
            agent_id: "agent_fixture",
            bounty_version: 3,
            status: "active",
            created_at: 1_787_572_900_000,
          },
          replayed: false,
        });
      });
    const client = createClient(api);
    const work = await client.bounties.open(webhookFixture.event);
    const outcome = await work.claim();

    expect(work.currentClaim).toBeNull();
    expect(outcome.outcome).toBe("claimed");
    expect(await api.calls[1]!.request.json()).toEqual({ expected_version: 3 });
    api.assertComplete();
  });

  it("uploads separately, then sends the durable attachment reference", async () => {
    let uploadBodyCanceled = false;
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/attachments", jsonResponse({
        attachment_id: "attachment_fixture",
        upload_url: "https://uploads.example.test/object",
        headers: {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="result.txt"',
        },
        expires_at: 1_787_573_200_000,
      }, 201))
      .expect("PUT", "/object", (request) => {
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("content-type")).toBe("text/plain");
        return new Response(new ReadableStream({
          cancel() {
            uploadBodyCanceled = true;
          },
        }), { status: 200 });
      })
      .expect(
        "POST",
        "/v1/agent/attachments/attachment_fixture/complete",
        jsonResponse({
          attachment_id: "attachment_fixture",
          size: 6,
          status: "ready",
          replayed: false,
        }),
      )
      .expect("POST", "/v1/agent/bounties/bounty_fixture/messages", jsonResponse({
        message: agentMessageFixture,
        replayed: false,
      }, 201));
    const work = await createClient(api).bounties.open("bounty_fixture");
    const attachment = await work.upload({
      filename: "result.txt",
      content_type: "text/plain",
      body: new TextEncoder().encode("result"),
    });
    await work.sendMessage({
      text: "Result attached.",
      attachments: [attachment],
      idempotency_key: "message:result:1",
    });

    expect(await api.calls[4]!.request.json()).toEqual({
      parts: [
        { type: "text", text: "Result attached." },
        { type: "file", attachment_id: "attachment_fixture" },
      ],
      idempotency_key: "message:result:1",
    });
    expect(uploadBodyCanceled).toBe(true);
    api.assertComplete();
  });

  it("preserves significant message whitespace", async () => {
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/messages", jsonResponse({
        message: agentMessageFixture,
        replayed: false,
      }, 201));
    const work = await createClient(api).bounties.open("bounty_fixture");
    const text = "    indented code\n\n";

    await work.sendMessage({ text, idempotency_key: "message:whitespace:1" });

    expect(await api.calls[1]!.request.json()).toEqual({
      content: { type: "text", text },
      idempotency_key: "message:whitespace:1",
    });
    api.assertComplete();
  });

  it("rejects messages above the 16-part contract limit", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/bounties/bounty_fixture",
      jsonResponse(bountyDetailsFixture),
    );
    const work = await createClient(api).bounties.open("bounty_fixture");
    const attachments = Array.from({ length: 17 }, (_, index) => ({
      attachment_id: `attachment_${index}`,
      filename: `file-${index}.txt`,
      content_type: "text/plain",
      size: 1,
      status: "ready" as const,
      replayed: false,
    }));

    expect(() => work.sendMessage({ attachments })).toThrow(
      BountyConfigurationError,
    );
    expect(() => work.sendMessage({
      text: "See the attached files.",
      attachments: attachments.slice(0, 16),
    })).toThrow(BountyConfigurationError);
    api.assertComplete();
  });

  it("surfaces stable Agent API errors", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/events",
      jsonResponse({
        error: { code: "INVALID_CURSOR", message: "Cursor expired" },
      }, 400),
    );

    const error = await createClient(api).events.poll({ cursor: "expired" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BountyApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "INVALID_CURSOR",
      message: "Cursor expired",
    });
    api.assertComplete();
  });

  it("retries safe writes with the same idempotency key", async () => {
    const bodies: unknown[] = [];
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/comments", async (request) => {
        bodies.push(await request.json());
        return jsonResponse(
          { error: { code: "RATE_LIMITED", message: "Try again" } },
          429,
          { "retry-after": "0" },
        );
      })
      .expect("POST", "/v1/agent/bounties/bounty_fixture/comments", async (request) => {
        bodies.push(await request.json());
        return jsonResponse({
          comment_id: "comment_fixture",
          watching: true,
          replayed: false,
        }, 201);
      });
    const work = await createClient(api, { maxRetries: 1 }).bounties.open(
      "bounty_fixture",
    );
    await work.comment({ body: "Can you clarify the format?" });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({
      body: "Can you clarify the format?",
      idempotency_key: expect.any(String),
    });
    api.assertComplete();
  });

  it("retries safe writes when a successful response body drops", async () => {
    const bodies: unknown[] = [];
    const droppedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"comment_id":'));
        controller.error(new TypeError("Connection reset"));
      },
    });
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/comments", async (request) => {
        bodies.push(await request.json());
        return new Response(droppedBody, {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      })
      .expect("POST", "/v1/agent/bounties/bounty_fixture/comments", async (request) => {
        bodies.push(await request.json());
        return jsonResponse({
          comment_id: "comment_fixture",
          watching: true,
          replayed: false,
        }, 201);
      });
    const work = await createClient(api, { maxRetries: 1 }).bounties.open(
      "bounty_fixture",
    );

    await work.comment({
      body: "Can you clarify the format?",
      idempotency_key: "comment:clarify:1",
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    api.assertComplete();
  });

  it("verifies the fixed webhook fixture and narrows known events", async () => {
    const api = new AgentApiMock();
    const client = createClient(api, { webhookSecret: webhookFixture.secret });
    const event = await client.webhooks.verify(
      new Request("https://agent.example.test/webhooks/bounty", {
        method: "POST",
        headers: webhookFixture.headers,
        body: webhookFixture.rawBody,
      }),
      { nowSeconds: webhookFixture.nowSeconds },
    );

    expect(event).toEqual(webhookFixture.event);
    expect(isAgentEvent(event, "bounty.available")).toBe(true);
  });

  it("verifies a webhook without constructing an API client", async () => {
    const event = await verifyWebhook(
      new Request("https://agent.example.test/webhooks/bounty", {
        method: "POST",
        headers: webhookFixture.headers,
        body: webhookFixture.rawBody,
      }),
      {
        secret: webhookFixture.secret,
        nowSeconds: webhookFixture.nowSeconds,
      },
    );

    expect(event).toEqual(webhookFixture.event);
  });

  it("rejects a modified webhook body", async () => {
    const client = createClient(new AgentApiMock(), {
      webhookSecret: webhookFixture.secret,
    });
    const verification = client.webhooks.verify(
      new Request("https://agent.example.test/webhooks/bounty", {
        method: "POST",
        headers: webhookFixture.headers,
        body: webhookFixture.rawBody.replace("automatic", "manual_release"),
      }),
      { nowSeconds: webhookFixture.nowSeconds },
    );

    await expect(verification).rejects.toMatchObject<BountyWebhookError>({
      reason: "invalid_signature",
    });
  });

  it("keeps a Work handle bound to its original Bounty identity", async () => {
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/claims", jsonResponse({
        outcome: "not_claimed",
        bounty_id: "bounty_fixture",
        reason: "already_claimed",
      }));
    const work = await createClient(api).bounties.open("bounty_fixture");

    expect(Object.isFrozen(work.bounty)).toBe(true);
    expect(Object.isFrozen(work.bounty.tags)).toBe(true);
    await work.claim();

    expect(await api.calls[1]!.request.json()).toEqual({ expected_version: 3 });
    api.assertComplete();
  });

  it("rejects Bounty details that do not match the requested identity", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/bounties/bounty_requested",
      jsonResponse({
        ...bountyDetailsFixture,
        bounty: { ...bountyFixture, _id: "bounty_other" },
      }),
    );

    await expect(createClient(api).bounties.open("bounty_requested")).rejects
      .toBeInstanceOf(BountyInvalidResponseError);
    api.assertComplete();
  });

  it("freezes every record exposed by a Work snapshot", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/bounties/bounty_fixture",
      jsonResponse({
        bounty: bountyFixture,
        attachments: [{
          fileUploadId: "attachment_fixture",
          filename: "brief.txt",
          contentType: "text/plain",
          size: 5,
          url: null,
          created_at: 1_787_572_100_000,
        }],
        comments: [{
          _id: "comment_fixture",
          author: {
            type: "agent",
            agent_id: "agent_fixture",
            name: "Research Agent",
            verified: true,
            rating_average: 5,
          },
          body: "I can complete this.",
          created_at: 1_787_572_200_000,
          updated_at: 1_787_572_200_000,
        }],
        claim: {
          claim_id: "claim_fixture",
          bounty_id: "bounty_fixture",
          agent_id: "agent_fixture",
          bounty_version: 3,
          status: "active",
          created_at: 1_787_572_300_000,
        },
      }),
    );
    const work = await createClient(api).bounties.open("bounty_fixture");

    expect(Object.isFrozen(work.attachments)).toBe(true);
    expect(Object.isFrozen(work.attachments[0])).toBe(true);
    expect(Object.isFrozen(work.comments)).toBe(true);
    expect(Object.isFrozen(work.comments[0])).toBe(true);
    expect(Object.isFrozen(work.comments[0]?.author)).toBe(true);
    expect(Object.isFrozen(work.currentClaim)).toBe(true);
    api.assertComplete();
  });

  it("does not narrow a future event version to the current data contract", async () => {
    const rawBody = JSON.stringify({
      ...webhookFixture.event,
      version: 2,
      data: { bounty_id: "bounty_fixture", future_field: true },
    });
    const request = await signedWebhookRequest({ rawBody });
    const event = await createClient(new AgentApiMock(), {
      webhookSecret: webhookFixture.secret,
    }).webhooks.verify(request, { nowSeconds: webhookFixture.nowSeconds });

    expect(event.version).toBe(2);
    expect(isAgentEvent(event, "bounty.available")).toBe(false);
  });

  it("accepts RFC 3339 event timestamps with timezone offsets", async () => {
    const rawBody = JSON.stringify({
      ...webhookFixture.event,
      occurredAt: "2026-08-24T05:00:00-07:00",
    });
    const request = await signedWebhookRequest({ rawBody });
    const event = await createClient(new AgentApiMock(), {
      webhookSecret: webhookFixture.secret,
    }).webhooks.verify(request, { nowSeconds: webhookFixture.nowSeconds });

    expect(event.occurredAt).toBe("2026-08-24T05:00:00-07:00");
    expect(isAgentEvent(event, "bounty.available")).toBe(true);
  });

  it("rejects structurally invalid successful API responses", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/bounties",
      jsonResponse({ bounties: [bountyFixture], is_done: true }),
    );

    await expect(createClient(api).bounties.list()).rejects.toBeInstanceOf(
      BountyInvalidResponseError,
    );
    api.assertComplete();
  });

  it("rejects Bounty terms outside the response contract", async () => {
    const invalidBounties = [
      { ...bountyFixture, amount_cents: -1 },
      { ...bountyFixture, payout_cents: -1 },
      { ...bountyFixture, currency: "" },
      { ...bountyFixture, version: 0 },
      { ...bountyFixture, delivery_window_ms: -1 },
      { ...bountyFixture, delivery_window_ms: 1.5 },
    ];

    for (const bounty of invalidBounties) {
      const api = new AgentApiMock().expect(
        "GET",
        "/v1/agent/bounties/bounty_fixture",
        jsonResponse({ ...bountyDetailsFixture, bounty }),
      );

      await expect(createClient(api).bounties.open("bounty_fixture")).rejects
        .toBeInstanceOf(BountyInvalidResponseError);
      api.assertComplete();
    }

    const { payout_cents: _payoutCents, ...missingPayout } = bountyFixture;
    const missingPayoutApi = new AgentApiMock().expect(
      "GET",
      "/v1/agent/bounties/bounty_fixture",
      jsonResponse({
        ...bountyDetailsFixture,
        bounty: missingPayout,
      }),
    );
    await expect(
      createClient(missingPayoutApi).bounties.open("bounty_fixture"),
    ).rejects.toBeInstanceOf(BountyInvalidResponseError);
    missingPayoutApi.assertComplete();
  });

  it("enforces submission request and response version bounds", async () => {
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/submissions", jsonResponse({
        submission_id: "submission_fixture",
        version: 0,
        verification_status: "pending",
        replayed: false,
      }, 201));
    const work = await createClient(api).bounties.open("bounty_fixture");
    const deliverables = Array.from({ length: 51 }, (_, index) => ({
      key: `result_${index}`,
      type: "text" as const,
      data: { text: "Result" },
    }));

    expect(() => work.submit({ deliverables })).toThrow(
      BountyConfigurationError,
    );
    await expect(work.submit({
      deliverables: [{
        key: "result",
        type: "text",
        data: { text: "Result" },
      }],
      idempotency_key: "submission:result:1",
    })).rejects.toBeInstanceOf(BountyInvalidResponseError);
    api.assertComplete();
  });

  it("downloads an Agent-owned attachment through its resource", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/attachments/attachment_fixture",
      (request) => {
        expect(request.headers.get("authorization")).toBe(
          "Bearer agent_key_test",
        );
        const response = new Response("file contents");
        Object.defineProperties(response, {
          redirected: { value: true },
          url: { value: "https://files.example.test/attachment_fixture" },
        });
        return response;
      },
    );

    const response = await createClient(api).attachments.download(
      "attachment_fixture",
    );
    expect(response.redirected).toBe(true);
    expect(response.url).toBe(
      "https://files.example.test/attachment_fixture",
    );
    expect(await response.text()).toBe("file contents");
    api.assertComplete();
  });

  it("keeps timeout and cancellation active for streamed downloads", async () => {
    const caller = new AbortController();
    const reason = new Error("stop download");
    let requestNumber = 0;
    const stalledDownloadFetch: typeof globalThis.fetch = (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requestNumber += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body));
    };
    const client = new Bounty({
      apiKey: "agent_key_test",
      baseURL: "https://api.example.test",
      fetch: stalledDownloadFetch,
      timeoutMs: 5,
      maxRetries: 0,
    });

    const timedResponse = await client.attachments.download("timeout_fixture");
    await expect(timedResponse.text()).rejects.toBeInstanceOf(
      BountyTimeoutError,
    );

    const canceledResponse = await client.attachments.download(
      "cancel_fixture",
      { signal: caller.signal },
    );
    globalThis.setTimeout(() => caller.abort(reason), 0);
    await expect(canceledResponse.text()).rejects.toBe(reason);
    expect(requestNumber).toBe(2);
  });

  it("does not retry attachment preparation", async () => {
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect(
        "POST",
        "/v1/agent/bounties/bounty_fixture/attachments",
        jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Failed" } }, 500),
      );
    const work = await createClient(api, { maxRetries: 2 }).bounties.open(
      "bounty_fixture",
    );

    await expect(work.upload({
      filename: "result.txt",
      content_type: "text/plain",
      body: new Uint8Array([1]),
    })).rejects.toMatchObject<BountyUploadError>({ stage: "prepare" });
    expect(api.calls).toHaveLength(2);
    api.assertComplete();
  });

  it("validates attachment completion before returning an upload", async () => {
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/bounties/bounty_fixture", jsonResponse(
        bountyDetailsFixture,
      ))
      .expect("POST", "/v1/agent/bounties/bounty_fixture/attachments", jsonResponse({
        attachment_id: "attachment_fixture",
        upload_url: "https://uploads.example.test/object",
        headers: {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="result.txt"',
        },
        expires_at: 1_787_573_200_000,
      }, 201))
      .expect("PUT", "/object", new Response(null, { status: 200 }))
      .expect(
        "POST",
        "/v1/agent/attachments/attachment_fixture/complete",
        jsonResponse({ attachment_id: "attachment_fixture", status: "broken" }),
      );
    const work = await createClient(api).bounties.open("bounty_fixture");

    await expect(work.upload({
      filename: "result.txt",
      content_type: "text/plain",
      body: new Uint8Array([1]),
    })).rejects.toMatchObject<BountyUploadError>({ stage: "complete" });
    api.assertComplete();
  });

  it("retries a per-attempt timeout, then raises a typed timeout", async () => {
    let attempts = 0;
    const stalledFetch: typeof globalThis.fetch = (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      attempts += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Timed out", "AbortError")),
          { once: true },
        );
      });
    };
    const client = new Bounty({
      apiKey: "agent_key_test",
      baseURL: "https://api.example.test",
      fetch: stalledFetch,
      timeoutMs: 5,
      maxRetries: 1,
    });

    await expect(client.events.poll()).rejects.toBeInstanceOf(
      BountyTimeoutError,
    );
    expect(attempts).toBe(2);
  });

  it("keeps the timeout active while consuming a JSON response", async () => {
    let abortObserved = false;
    const stalledBodyFetch: typeof globalThis.fetch = (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            abortObserved = true;
            controller.error(new DOMException("Timed out", "AbortError"));
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body, {
        headers: { "content-type": "application/json" },
      }));
    };
    const client = new Bounty({
      apiKey: "agent_key_test",
      baseURL: "https://api.example.test",
      fetch: stalledBodyFetch,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(client.events.poll()).rejects.toBeInstanceOf(
      BountyTimeoutError,
    );
    expect(abortObserved).toBe(true);
  });

  it("keeps caller cancellation active while consuming a JSON response", async () => {
    const controller = new AbortController();
    const reason = new Error("stop reading");
    let abortObserved = false;
    const stalledBodyFetch: typeof globalThis.fetch = (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const body = new ReadableStream<Uint8Array>({
        start(bodyController) {
          init?.signal?.addEventListener("abort", () => {
            abortObserved = true;
            bodyController.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      });
      globalThis.setTimeout(() => controller.abort(reason), 0);
      return Promise.resolve(new Response(body, {
        headers: { "content-type": "application/json" },
      }));
    };
    const client = new Bounty({
      apiKey: "agent_key_test",
      baseURL: "https://api.example.test",
      fetch: stalledBodyFetch,
      timeoutMs: 1_000,
      maxRetries: 0,
    });

    await expect(client.events.poll({ signal: controller.signal })).rejects
      .toBe(reason);
    expect(abortObserved).toBe(true);
  });

  it("aborts immediately while waiting to retry", async () => {
    const controller = new AbortController();
    const reason = new Error("stop retrying");
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/events",
      () => {
        controller.abort(reason);
        return jsonResponse(
          { error: { code: "RATE_LIMITED", message: "Try later" } },
          429,
          { "retry-after": "60" },
        );
      },
    );

    await expect(createClient(api, { maxRetries: 2 }).events.poll({
      signal: controller.signal,
    })).rejects.toBe(reason);
    expect(api.calls).toHaveLength(1);
    api.assertComplete();
  });

  it("preserves a final Retry-After date on the API error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/events",
      jsonResponse(
        { error: { code: "RATE_LIMITED", message: "Try later" } },
        429,
        { "retry-after": "Sun, 24 Aug 2026 12:00:05 GMT" },
      ),
    );

    const error = await createClient(api).events.poll().catch(
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject<BountyApiError>({ retryAfterMs: 5_000 });
    api.assertComplete();
  });

  it("does not automatically retry an excessive Retry-After delay", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/events",
      jsonResponse(
        { error: { code: "RATE_LIMITED", message: "Try later" } },
        429,
        { "retry-after": "300" },
      ),
    );

    const error = await createClient(api, { maxRetries: 2 }).events.poll()
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject<BountyApiError>({ retryAfterMs: 300_000 });
    expect(api.calls).toHaveLength(1);
    api.assertComplete();
  });

  it("follows event cursors without hiding durable checkpoints", async () => {
    const controller = new AbortController();
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/events", jsonResponse({
        events: [webhookFixture.event],
        next_cursor: "cursor_1",
        has_more: true,
      }))
      .expect("GET", "/v1/agent/events", jsonResponse({
        events: [],
        next_cursor: "cursor_2",
        has_more: false,
      }));
    const pages = createClient(api).events.follow({
      cursor: "cursor_0",
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    expect((await pages.next()).value?.next_cursor).toBe("cursor_1");
    expect((await pages.next()).value?.next_cursor).toBe("cursor_2");
    controller.abort();
    await pages.return?.();
    expect(new URL(api.calls[0]!.request.url).searchParams.get("cursor")).toBe(
      "cursor_0",
    );
    expect(new URL(api.calls[1]!.request.url).searchParams.get("cursor")).toBe(
      "cursor_1",
    );
    api.assertComplete();
  });

  it("stops following a nonadvancing backlog cursor", async () => {
    const api = new AgentApiMock().expect(
      "GET",
      "/v1/agent/events",
      jsonResponse({
        events: [webhookFixture.event],
        next_cursor: "cursor_0",
        has_more: true,
      }),
    );
    const pages = createClient(api).events.follow({ cursor: "cursor_0" })
      [Symbol.asyncIterator]();

    expect((await pages.next()).value?.next_cursor).toBe("cursor_0");
    await expect(pages.next()).rejects.toBeInstanceOf(
      BountyConfigurationError,
    );
    expect(api.calls).toHaveLength(1);
    api.assertComplete();
  });

  it("backs off after the event follower catches up", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const api = new AgentApiMock()
      .expect("GET", "/v1/agent/events", jsonResponse({
        events: [],
        next_cursor: "cursor_1",
        has_more: false,
      }))
      .expect("GET", "/v1/agent/events", jsonResponse({
        events: [],
        next_cursor: "cursor_2",
        has_more: false,
      }));
    const pages = createClient(api).events.follow({
      cursor: "cursor_0",
      idleDelayMs: 1_000,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    expect((await pages.next()).value?.next_cursor).toBe("cursor_1");
    const secondPage = pages.next();
    await vi.advanceTimersByTimeAsync(999);
    expect(api.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await secondPage).value?.next_cursor).toBe("cursor_2");
    controller.abort();
    await pages.return?.();
    api.assertComplete();
  });

  it("supports webhook secret rotation", async () => {
    const request = await signedWebhookRequest({
      rawBody: webhookFixture.rawBody,
    });
    const event = await createClient(new AgentApiMock(), {
      webhookSecret: [
        ["whsec", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="].join("_"),
        webhookFixture.secret,
      ],
    }).webhooks.verify(request, { nowSeconds: webhookFixture.nowSeconds });

    expect(event.id).toBe(webhookFixture.event.id);
  });

  it("rejects missing, stale, mismatched, and oversized webhooks", async () => {
    const client = createClient(new AgentApiMock(), {
      webhookSecret: webhookFixture.secret,
    });
    const missingHeader = new Request("https://agent.example.test/webhook", {
      method: "POST",
      body: webhookFixture.rawBody,
    });
    await expect(client.webhooks.verify(missingHeader)).rejects.toMatchObject({
      reason: "missing_header",
    });

    const stale = await signedWebhookRequest({
      rawBody: webhookFixture.rawBody,
      timestamp: "1787572000",
    });
    await expect(client.webhooks.verify(stale, {
      nowSeconds: webhookFixture.nowSeconds,
    })).rejects.toMatchObject({ reason: "timestamp_out_of_tolerance" });

    const mismatchedBody = JSON.stringify({
      ...webhookFixture.event,
      id: "evt_body",
    });
    const mismatched = await signedWebhookRequest({
      rawBody: mismatchedBody,
      webhookId: "evt_header",
    });
    await expect(client.webhooks.verify(mismatched, {
      nowSeconds: webhookFixture.nowSeconds,
    })).rejects.toMatchObject({ reason: "event_id_mismatch" });

    const oversized = await signedWebhookRequest({
      rawBody: webhookFixture.rawBody,
    });
    await expect(client.webhooks.verify(oversized, {
      nowSeconds: webhookFixture.nowSeconds,
      maxBodyBytes: 10,
    })).rejects.toMatchObject({ reason: "payload_too_large" });
  });

  it("rejects invalid webhook bytes and verification options", async () => {
    const client = createClient(new AgentApiMock(), {
      webhookSecret: webhookFixture.secret,
    });
    const invalidUtf8 = await signedWebhookRequest({
      rawBody: new Uint8Array([0xff]),
    });
    await expect(client.webhooks.verify(invalidUtf8, {
      nowSeconds: webhookFixture.nowSeconds,
    })).rejects.toMatchObject({ reason: "invalid_event" });

    const request = await signedWebhookRequest({
      rawBody: webhookFixture.rawBody,
    });
    await expect(client.webhooks.verify(request, {
      nowSeconds: Number.NaN,
    })).rejects.toBeInstanceOf(BountyConfigurationError);
  });

  it("blocks browser use unless it is explicitly acknowledged", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});

    expect(() => createClient(new AgentApiMock())).toThrow(
      BountyConfigurationError,
    );
    expect(() => createClient(new AgentApiMock(), {
      dangerouslyAllowBrowser: true,
    })).not.toThrow();
  });

  it("requires HTTPS except for loopback development", () => {
    expect(() => createClient(new AgentApiMock(), {
      baseURL: "http://api.example.test",
    })).toThrow(BountyConfigurationError);
    expect(() => createClient(new AgentApiMock(), {
      baseURL: "http://localhost:8787",
    })).not.toThrow();
    expect(() => createClient(new AgentApiMock(), {
      baseURL: "http://api.example.test",
      dangerouslyAllowInsecureConnection: true,
    })).not.toThrow();
  });
});
