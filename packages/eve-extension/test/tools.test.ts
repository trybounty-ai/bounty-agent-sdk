import type { Work } from "@bounty-ai/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bountyCommentInput,
  bountyMessageInput,
  bountySubmissionInput,
  createBountyTools,
  type BountyToolDependencies,
} from "../extension/tools/bounty.js";

const bountyDetails = vi.fn<BountyToolDependencies["details"]>();
const claim = vi.fn<Work["claim"]>();
const comment = vi.fn<Work["comment"]>();
const channelMetadata = vi.fn<BountyToolDependencies["metadata"]>();
const messages = vi.fn<Work["messages"]>();
const open = vi.fn<BountyToolDependencies["open"]>();
const sendMessage = vi.fn<Work["sendMessage"]>();
const submit = vi.fn<Work["submit"]>();
const bountyTools = createBountyTools({
  details: bountyDetails,
  metadata: channelMetadata,
  open,
});

const resolveTools = bountyTools.events["session.started"];
if (!resolveTools) throw new Error("Bounty tool resolver is missing");

describe("Eve Bounty tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelMetadata.mockReturnValue({
      agentId: "agent_1",
      bountyId: "bounty_1",
    });
  });

  it("binds marketplace writes to trusted channel state and stable call IDs", async () => {
    const signal = new AbortController().signal;
    const work = {
      claim,
      comment,
      messages,
      sendMessage,
      submit,
    };
    // SAFETY: Each test invokes only the Work methods implemented by this fake.
    open.mockResolvedValue(work as never);
    comment.mockResolvedValue({
      comment_id: "comment_1",
      watching: true,
      replayed: false,
    });
    sendMessage.mockResolvedValue({
      message: {
        _id: "message_1",
        bounty_id: "bounty_1",
        claim_id: "claim_1",
        author_type: "agent",
        agent_id: "agent_1",
        content: { type: "text", text: "Starting now." },
        parts: [{ type: "text", text: "Starting now." }],
        idempotency_key: "eve:call_1:message",
        created_at: 1,
      },
      replayed: false,
    });
    submit.mockResolvedValue({
      submission_id: "submission_1",
      version: 1,
      verification_status: "pending",
      replayed: false,
    });

    // SAFETY: The resolver reads only channel metadata from this Eve event context.
    const tools = await resolveTools({} as never, {
      channel: {
        kind: "channel:bounty",
        metadata: { agentId: "agent_1", bountyId: "bounty_1" },
      },
    } as never);
    expect(tools).not.toBeNull();
    if (!tools || !("comment-on-bounty" in tools)) {
      throw new Error("Bounty tools were not resolved");
    }

    // SAFETY: Tool execution reads only the abort signal and stable call ID.
    const context = { abortSignal: signal, callId: "call_1" } as never;
    await tools["comment-on-bounty"].execute({ body: "Can you clarify?" }, context);
    await tools["message-bounty-owner"].execute({ text: "Starting now." }, context);
    await tools["submit-bounty"].execute({
      deliverables: [{
        key: "report",
        type: "text",
        data: { text: "Done." },
      }],
    }, context);

    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledWith("bounty_1", { signal });
    expect(comment).toHaveBeenCalledWith({
      body: "Can you clarify?",
      idempotency_key: "eve:call_1:comment",
      signal,
    });
    expect(sendMessage).toHaveBeenCalledWith({
      text: "Starting now.",
      idempotency_key: "eve:call_1:message",
      signal,
    });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: "eve:call_1:submission",
      signal,
    }));
  });

  it("does not expose Bounty-scoped tools outside the Bounty channel", async () => {
    channelMetadata.mockReturnValueOnce(undefined);

    // SAFETY: The resolver reads only channel identity from this Eve context.
    const tools = await resolveTools({} as never, {
      channel: { kind: "channel:other", metadata: {} },
    } as never);

    expect(tools).toBeNull();
  });

  it("rejects table deliverables outside the API row limits", async () => {
    // SAFETY: The resolver reads only channel identity from this Eve context.
    const tools = await resolveTools({} as never, {
      channel: {
        kind: "channel:bounty",
        metadata: { agentId: "agent_1", bountyId: "bounty_1" },
      },
    } as never);
    if (!tools || !("submit-bounty" in tools)) {
      throw new Error("Bounty tools were not resolved");
    }

    const table = (rows: Array<Record<string, string>>) => ({
      deliverables: [{
        key: "results",
        type: "table" as const,
        data: { rows },
      }],
    });

    expect(bountySubmissionInput.safeParse(table([])).success).toBe(false);
    expect(bountySubmissionInput.safeParse(table([{ value: "ok" }])).success)
      .toBe(true);
    expect(bountySubmissionInput.safeParse(table(Array.from(
      { length: 501 },
      (_, index) => ({ value: String(index) }),
    ))).success).toBe(false);
    expect(bountySubmissionInput.safeParse({
      deliverables: Array.from({ length: 51 }, (_, index) => ({
        key: `result-${index}`,
        type: "text" as const,
        data: { text: "Done." },
      })),
    }).success).toBe(false);
  });

  it("rejects comments and messages over the API text limit", () => {
    const allowed = "a".repeat(4_000);
    const tooLong = `${allowed}a`;

    expect(bountyCommentInput.safeParse({ body: allowed }).success).toBe(true);
    expect(bountyCommentInput.safeParse({ body: tooLong }).success).toBe(false);
    expect(bountyMessageInput.safeParse({ text: allowed }).success).toBe(true);
    expect(bountyMessageInput.safeParse({ text: tooLong }).success).toBe(false);
  });
});
