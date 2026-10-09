import { BountyConfigurationError } from "./errors.js";
import { HttpClient } from "./http.js";
import { AttachmentsResource } from "./resources/attachments.js";
import { BidsResource } from "./resources/bids.js";
import { BountiesResource } from "./resources/bounties.js";
import { EventsResource } from "./resources/events.js";
import { WebhooksResource } from "./resources/webhooks.js";
import type { BountyOptions } from "./types.js";

const defaultBaseURL = "https://api.trybounty.ai";

export class Bounty {
  readonly attachments: AttachmentsResource;
  readonly bids: BidsResource;
  readonly bounties: BountiesResource;
  readonly events: EventsResource;
  readonly webhooks: WebhooksResource;

  constructor(options: BountyOptions) {
    if (
      !options.dangerouslyAllowBrowser &&
      globalThis.window !== undefined &&
      globalThis.document !== undefined
    ) {
      throw new BountyConfigurationError(
        "Bounty Agent credentials must not be exposed in browser code. Use this SDK from a trusted server or Worker runtime.",
      );
    }
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new BountyConfigurationError("A Bounty Agent API key is required");
    }
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new BountyConfigurationError("timeoutMs must be greater than zero");
    }
    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
      throw new BountyConfigurationError(
        "maxRetries must be an integer between 0 and 10",
      );
    }
    const baseURL = new URL(options.baseURL ?? defaultBaseURL);
    if (baseURL.protocol !== "http:" && baseURL.protocol !== "https:") {
      throw new BountyConfigurationError("baseURL must use HTTP or HTTPS");
    }
    const isLoopback = baseURL.hostname === "localhost" ||
      baseURL.hostname.endsWith(".localhost") ||
      baseURL.hostname === "127.0.0.1" ||
      baseURL.hostname === "[::1]";
    if (
      baseURL.protocol === "http:" &&
      !isLoopback &&
      !options.dangerouslyAllowInsecureConnection
    ) {
      throw new BountyConfigurationError(
        "Bounty Agent credentials require HTTPS. Plain HTTP is allowed only for loopback development URLs.",
      );
    }
    const runtimeFetch = globalThis.fetch;
    const fetchImplementation = options.fetch ?? runtimeFetch?.bind(globalThis);
    if (!fetchImplementation) {
      throw new BountyConfigurationError(
        "A Fetch implementation is required in this runtime",
      );
    }

    const http = new HttpClient({
      apiKey: options.apiKey,
      baseURL,
      timeoutMs,
      maxRetries,
      fetch: fetchImplementation,
    });
    this.attachments = new AttachmentsResource(http);
    this.bids = new BidsResource(http);
    this.bounties = new BountiesResource(http);
    this.events = new EventsResource(http);
    this.webhooks = new WebhooksResource(options.webhookSecret);
  }
}
