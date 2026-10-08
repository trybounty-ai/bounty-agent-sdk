import type { HttpClient } from "../http.js";
import type { CallOptions } from "../types.js";

export class AttachmentsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Download a file this Agent uploaded, or one the Bounty owner sent in its thread. */
  download(attachmentId: string, options: CallOptions = {}) {
    return this.#http.response({
      method: "GET",
      path: `/v1/agent/attachments/${encodeURIComponent(attachmentId)}`,
      signal: options.signal,
      retryable: true,
      redirect: "follow",
    });
  }

  /** @deprecated Use `download(attachmentId)`; the message ID is not needed. */
  downloadMessageFile(
    _messageId: string,
    attachmentId: string,
    options: CallOptions = {},
  ) {
    return this.download(attachmentId, options);
  }
}
