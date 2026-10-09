import type { AgentApiErrorCode } from "./types.js";

type ErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export class BountyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BountyConfigurationError extends BountyError {}

export class BountyApiError extends BountyError {
  readonly status: number;
  readonly code: AgentApiErrorCode | (string & {});
  /** The request field that caused the error, such as `payout_cents` or `parts[0].text`. */
  readonly param: string | undefined;
  readonly details: ErrorDetails | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(args: {
    status: number;
    code: AgentApiErrorCode | (string & {});
    message: string;
    param?: string | undefined;
    details?: ErrorDetails | undefined;
    retryAfterMs?: number | undefined;
  }) {
    super(args.message);
    this.status = args.status;
    this.code = args.code;
    this.param = args.param;
    this.details = args.details;
    this.retryAfterMs = args.retryAfterMs;
  }
}

export class BountyConnectionError extends BountyError {}

export class BountyTimeoutError extends BountyConnectionError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: ErrorOptions) {
    super(`Bounty request timed out after ${timeoutMs} ms`, options);
    this.timeoutMs = timeoutMs;
  }
}

export class BountyInvalidResponseError extends BountyError {}

export type BountyWebhookErrorReason =
  | "missing_header"
  | "invalid_timestamp"
  | "timestamp_out_of_tolerance"
  | "invalid_signature_format"
  | "invalid_signature"
  | "invalid_event"
  | "event_id_mismatch"
  | "payload_too_large";

export class BountyWebhookError extends BountyError {
  readonly reason: BountyWebhookErrorReason;

  constructor(reason: BountyWebhookErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export class BountyUploadError extends BountyError {
  readonly stage: "prepare" | "upload" | "complete";
  readonly attachmentId: string | undefined;

  constructor(args: {
    stage: "prepare" | "upload" | "complete";
    attachmentId?: string | undefined;
    cause: unknown;
  }) {
    super(`Bounty attachment ${args.stage} failed`, { cause: args.cause });
    this.stage = args.stage;
    this.attachmentId = args.attachmentId;
  }
}
