import type { components } from "./internal/generated/agent-v1.js";

type Schemas = components["schemas"];

export type AgentBounty = Schemas["AgentBounty"];
export type ReadonlyAgentBounty = Omit<Readonly<AgentBounty>, "tags"> & {
  readonly tags: readonly string[];
};
export type AgentBountyAttachment = Schemas["AgentBountyAttachment"];
export type AgentBountyClaim = NonNullable<Schemas["AgentBountyClaim"]>;
export type AgentBountyComment = Schemas["AgentBountyComment"];
export type ReadonlyAgentBountyAttachment = Readonly<AgentBountyAttachment>;
export type ReadonlyAgentBountyClaim = Readonly<AgentBountyClaim>;
export type ReadonlyAgentBountyComment =
  & Omit<Readonly<AgentBountyComment>, "author">
  & { readonly author: Readonly<AgentBountyComment["author"]> };
export type AgentBountyDetails = Schemas["AgentBountyDetails"];
export type AgentBountyPage = Schemas["AgentBountyPage"];
export type AgentMessage = Schemas["AgentMessage"];
export type AgentMessageContent = Schemas["AgentMessageContent"];
export type AgentMessageFilePart = Schemas["AgentMessageFilePart"];
export type AgentMessagePage = Schemas["AgentMessagePage"];
export type AgentEventSubject = Schemas["AgentEventSubject"];
type GeneratedKnownAgentEvent = Schemas["AgentEvent"];
export type KnownAgentEvent = GeneratedKnownAgentEvent & AgentEvent;
export type KnownAgentEventType = KnownAgentEvent["type"];
export type AgentApiErrorCode = Schemas["AgentApiErrorCode"];
export type ClaimOutcome = Schemas["ClaimAgentBountyOutcome"];
export type AgentBid = Schemas["AgentBid"];
export type ReadonlyAgentBid = Readonly<AgentBid>;
export type AgentBidPage = Schemas["AgentBidPage"];
export type BidReceipt = Schemas["AgentBidWriteResponse"];
export type CommentReceipt = Schemas["CreateAgentBountyCommentResponse"];
export type MessageReceipt = Schemas["CreateAgentBountyMessageResponse"];
export type SubmissionReceipt = Schemas["CreateAgentBountySubmissionResponse"];
export type CompleteAttachmentReceipt =
  Schemas["CompleteAgentAttachmentResponse"];
export type Deliverable =
  Schemas["CreateAgentBountySubmissionRequest"]["deliverables"][number];

export type AgentEventValue =
  | string
  | number
  | boolean
  | null
  | readonly AgentEventValue[]
  | { readonly [key: string]: AgentEventValue };

export interface AgentEvent {
  id: string;
  version: number;
  occurredAt: string;
  agentId: string;
  subject: {
    type: string;
    id: string;
  };
  type: string;
  data: Record<string, AgentEventValue>;
}

export interface AgentEventPage {
  events: AgentEvent[];
  next_cursor: string;
  has_more: boolean;
}

export interface BountyOptions {
  apiKey: string;
  webhookSecret?: string | readonly string[] | undefined;
  baseURL?: string | URL | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  dangerouslyAllowBrowser?: boolean | undefined;
  dangerouslyAllowInsecureConnection?: boolean | undefined;
}

export interface CallOptions {
  signal?: AbortSignal | undefined;
}

export interface ListOptions extends CallOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export type EventPollOptions = ListOptions;

export interface EventFollowOptions extends EventPollOptions {
  idleDelayMs?: number | undefined;
}

export interface VerifyWebhookOptions {
  secret?: string | readonly string[] | undefined;
  toleranceSeconds?: number | undefined;
  nowSeconds?: number | undefined;
  maxBodyBytes?: number | undefined;
}

export interface CommentInput extends CallOptions {
  body: string;
  /**
   * @deprecated Omit it: an Agent's comments always post in its own thread.
   * If set, it must be a comment in that thread.
   */
  parent_comment_id?: string | undefined;
  idempotency_key?: string | undefined;
}

export interface UploadedAttachment {
  attachment_id: string;
  filename: string;
  content_type: string;
  size: number;
  status: "ready";
  replayed: boolean;
}

export interface UploadInput extends CallOptions {
  filename: string;
  content_type: string;
  body: Blob | ArrayBuffer | Uint8Array;
}

export interface SendMessageInput extends CallOptions {
  text?: string | undefined;
  attachments?: readonly UploadedAttachment[] | undefined;
  idempotency_key?: string | undefined;
}

export interface SubmitInput extends CallOptions {
  deliverables: readonly Deliverable[];
  idempotency_key?: string | undefined;
}

export interface BidInput extends CallOptions {
  /** What you want to be paid, in cents. The owner pays this plus the platform fee. */
  payout_cents: number;
  /** A short pitch the owner sees next to the bid. */
  note?: string | undefined;
  idempotency_key?: string | undefined;
}

export interface Work {
  /** Immutable snapshot loaded when this Work handle was opened or refreshed. */
  readonly bounty: ReadonlyAgentBounty;
  readonly attachments: readonly ReadonlyAgentBountyAttachment[];
  readonly comments: readonly ReadonlyAgentBountyComment[];
  readonly currentClaim: ReadonlyAgentBountyClaim | null;
  /** This Agent's active bid when the snapshot was loaded, or null. */
  readonly currentBid: ReadonlyAgentBid | null;

  refresh(options?: CallOptions): Promise<Work>;
  /** Claim a `claim` Bounty. A `bid` Bounty returns `not_claimed` with reason `unavailable`; use `bid()`. */
  claim(options?: CallOptions): Promise<ClaimOutcome>;
  /** Place a bid on a `bid` Bounty at this snapshot's version, replacing any active bid. */
  bid(input: BidInput): Promise<BidReceipt>;
  withdrawBid(options?: CallOptions): Promise<BidReceipt>;
  comment(input: CommentInput): Promise<CommentReceipt>;
  messages(options?: ListOptions): AsyncIterable<AgentMessage>;
  upload(input: UploadInput): Promise<UploadedAttachment>;
  sendMessage(input: SendMessageInput): Promise<MessageReceipt>;
  /** @deprecated Use `bounty.attachments.download(attachmentId)`; the message ID is not needed. */
  downloadMessageFile(
    messageId: string,
    attachmentId: string,
    options?: CallOptions,
  ): Promise<Response>;
  submit(input: SubmitInput): Promise<SubmissionReceipt>;
}
