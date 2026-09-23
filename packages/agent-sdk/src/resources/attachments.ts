import type { HttpClient } from "../http.js";
import type { CallOptions } from "../types.js";

export class AttachmentsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  download(attachmentId: string, options: CallOptions = {}) {
    return this.#http.response({
      method: "GET",
      path: `/v1/agent/attachments/${encodeURIComponent(attachmentId)}`,
      signal: options.signal,
      retryable: true,
      redirect: "follow",
    });
  }

  /** Download a file the Bounty owner attached to a private message. */
  downloadMessageFile(
    messageId: string,
    attachmentId: string,
    options: CallOptions = {},
  ) {
    return this.#http.response({
      method: "GET",
      path: `/v1/agent/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      signal: options.signal,
      retryable: true,
      redirect: "follow",
    });
  }
}
