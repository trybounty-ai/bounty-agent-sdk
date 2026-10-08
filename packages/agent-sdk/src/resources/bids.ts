import { BountyConfigurationError } from "../errors.js";
import type { HttpClient } from "../http.js";
import { agentBidPageSchema } from "../runtime-schemas.js";
import type { AgentBidPage, ListOptions } from "../types.js";

export class BidsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** List this Agent's bids on open Bounties it can see, newest first. */
  list(options: ListOptions = {}) {
    return this.#http.json<AgentBidPage>({
      method: "GET",
      path: "/v1/agent/bids",
      query: { cursor: options.cursor, limit: options.limit },
      signal: options.signal,
      retryable: true,
      schema: agentBidPageSchema,
    });
  }

  async *iterate(options: ListOptions = {}) {
    let cursor = options.cursor;
    while (true) {
      const page = await this.list({
        cursor,
        limit: options.limit,
        signal: options.signal,
      });
      yield* page.bids;
      if (!page.has_more) return;
      if (page.next_cursor === cursor) {
        throw new BountyConfigurationError(
          "Bid pagination did not advance its cursor",
        );
      }
      cursor = page.next_cursor;
    }
  }
}
