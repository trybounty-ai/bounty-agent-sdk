import {
  BountyConfigurationError,
  BountyUploadError,
} from "./errors.js";
import type { HttpClient } from "./http.js";
import { AttachmentsResource } from "./resources/attachments.js";
import {
  agentBountyDetailsSchema,
  agentMessagePageSchema,
  attachmentTicketSchema,
  claimOutcomeSchema,
  commentReceiptSchema,
  completeAttachmentReceiptSchema,
  messageReceiptSchema,
  submissionReceiptSchema,
} from "./runtime-schemas.js";
import type {
  AgentBountyDetails,
  AgentMessage,
  AgentMessagePage,
  CallOptions,
  ClaimOutcome,
  CommentInput,
  CommentReceipt,
  CompleteAttachmentReceipt,
  ListOptions,
  MessageReceipt,
  ReadonlyAgentBounty,
  ReadonlyAgentBountyAttachment,
  ReadonlyAgentBountyClaim,
  ReadonlyAgentBountyComment,
  SendMessageInput,
  SubmissionReceipt,
  SubmitInput,
  UploadedAttachment,
  UploadInput,
  Work,
} from "./types.js";

interface AttachmentTicket {
  attachment_id: string;
  upload_url: string;
  headers: {
    "content-type": string;
    "content-disposition": string;
  };
  expires_at: number;
}

interface CommentRequestBody {
  body: string;
  parent_comment_id?: string;
  idempotency_key: string;
}

export class WorkImplementation implements Work {
  readonly #http: HttpClient;
  readonly #bountyId: string;
  readonly #bountyVersion: number;
  readonly bounty: ReadonlyAgentBounty;
  readonly attachments: readonly ReadonlyAgentBountyAttachment[];
  readonly comments: readonly ReadonlyAgentBountyComment[];
  readonly currentClaim: ReadonlyAgentBountyClaim | null;

  constructor(http: HttpClient, details: AgentBountyDetails) {
    this.#http = http;
    this.#bountyId = details.bounty._id;
    this.#bountyVersion = details.bounty.version;
    this.bounty = Object.freeze({
      ...details.bounty,
      tags: Object.freeze([...details.bounty.tags]),
    });
    this.attachments = Object.freeze(
      details.attachments.map((attachment) => Object.freeze({ ...attachment })),
    );
    this.comments = Object.freeze(
      details.comments.map((comment) => Object.freeze({
        ...comment,
        author: Object.freeze({ ...comment.author }),
      })),
    );
    this.currentClaim = details.claim
      ? Object.freeze({ ...details.claim })
      : null;
  }

  async refresh(options: CallOptions = {}) {
    const details = await this.#http.json<AgentBountyDetails>({
      method: "GET",
      path: this.#bountyPath(),
      signal: options.signal,
      retryable: true,
      schema: agentBountyDetailsSchema,
    });
    return new WorkImplementation(this.#http, details);
  }

  claim(options: CallOptions = {}) {
    return this.#http.json<ClaimOutcome>({
      method: "POST",
      path: `${this.#bountyPath()}/claims`,
      body: { expected_version: this.#bountyVersion },
      signal: options.signal,
      retryable: true,
      schema: claimOutcomeSchema,
    });
  }

  comment(input: CommentInput) {
    const body: CommentRequestBody = {
      body: input.body,
      idempotency_key: input.idempotency_key ?? crypto.randomUUID(),
    };
    if (input.parent_comment_id !== undefined) {
      body.parent_comment_id = input.parent_comment_id;
    }
    return this.#http.json<CommentReceipt>({
      method: "POST",
      path: `${this.#bountyPath()}/comments`,
      body,
      signal: input.signal,
      retryable: true,
      schema: commentReceiptSchema,
    });
  }

  async *messages(options: ListOptions = {}): AsyncIterable<AgentMessage> {
    let cursor = options.cursor;
    while (true) {
      const page = await this.#http.json<AgentMessagePage>({
        method: "GET",
        path: `${this.#bountyPath()}/messages`,
        query: { cursor, limit: options.limit },
        signal: options.signal,
        retryable: true,
        schema: agentMessagePageSchema,
      });
      yield* page.messages;
      if (page.is_done) return;
      if (page.next_cursor === cursor) {
        throw new BountyConfigurationError(
          "Message pagination did not advance its cursor",
        );
      }
      cursor = page.next_cursor;
    }
  }

  async upload(input: UploadInput): Promise<UploadedAttachment> {
    const size = input.body instanceof Blob
      ? input.body.size
      : input.body.byteLength;
    let ticket: AttachmentTicket;
    try {
      ticket = await this.#http.json<AttachmentTicket>({
        method: "POST",
        path: `${this.#bountyPath()}/attachments`,
        body: {
          filename: input.filename,
          content_type: input.content_type,
          size,
        },
        signal: input.signal,
        schema: attachmentTicketSchema,
      });
    } catch (cause) {
      throw new BountyUploadError({ stage: "prepare", cause });
    }

    try {
      const response = await this.#http.response({
        method: "PUT",
        url: ticket.upload_url,
        headers: ticket.headers,
        body: input.body,
        signal: input.signal,
        retryable: true,
        authenticated: false,
      });
      await response.body?.cancel();
    } catch (cause) {
      throw new BountyUploadError({
        stage: "upload",
        attachmentId: ticket.attachment_id,
        cause,
      });
    }

    let completed: CompleteAttachmentReceipt;
    try {
      completed = await this.#http.json<CompleteAttachmentReceipt>({
        method: "POST",
        path: `/v1/agent/attachments/${encodeURIComponent(ticket.attachment_id)}/complete`,
        signal: input.signal,
        retryable: true,
        schema: completeAttachmentReceiptSchema,
      });
    } catch (cause) {
      throw new BountyUploadError({
        stage: "complete",
        attachmentId: ticket.attachment_id,
        cause,
      });
    }

    return {
      ...completed,
      filename: input.filename,
      content_type: input.content_type,
    };
  }

  sendMessage(input: SendMessageInput) {
    const text = input.text;
    const hasText = Boolean(text?.trim());
    const attachments = input.attachments ?? [];
    if (!hasText && attachments.length === 0) {
      throw new BountyConfigurationError(
        "A Bounty message needs text or at least one attachment",
      );
    }
    const partCount = attachments.length + (hasText ? 1 : 0);
    if (partCount > 16) {
      throw new BountyConfigurationError(
        "A Bounty message cannot contain more than 16 parts",
      );
    }

    const idempotencyKey = input.idempotency_key ?? crypto.randomUUID();
    const body = attachments.length === 0
      ? {
          content: { type: "text" as const, text: text! },
          idempotency_key: idempotencyKey,
        }
      : {
          parts: [
            ...(hasText ? [{ type: "text" as const, text: text! }] : []),
            ...attachments.map((attachment) => ({
              type: "file" as const,
              attachment_id: attachment.attachment_id,
            })),
          ],
          idempotency_key: idempotencyKey,
        };
    return this.#http.json<MessageReceipt>({
      method: "POST",
      path: `${this.#bountyPath()}/messages`,
      body,
      signal: input.signal,
      retryable: true,
      schema: messageReceiptSchema,
    });
  }

  downloadMessageFile(
    messageId: string,
    attachmentId: string,
    options: CallOptions = {},
  ) {
    return new AttachmentsResource(this.#http).downloadMessageFile(
      messageId,
      attachmentId,
      options,
    );
  }

  submit(input: SubmitInput) {
    if (input.deliverables.length === 0) {
      throw new BountyConfigurationError(
        "A Bounty submission needs at least one deliverable",
      );
    }
    if (input.deliverables.length > 50) {
      throw new BountyConfigurationError(
        "A Bounty submission cannot contain more than 50 deliverables",
      );
    }
    return this.#http.json<SubmissionReceipt>({
      method: "POST",
      path: `${this.#bountyPath()}/submissions`,
      body: {
        deliverables: input.deliverables,
        idempotency_key: input.idempotency_key ?? crypto.randomUUID(),
      },
      signal: input.signal,
      retryable: true,
      schema: submissionReceiptSchema,
    });
  }

  #bountyPath() {
    return `/v1/agent/bounties/${encodeURIComponent(this.#bountyId)}`;
  }
}
