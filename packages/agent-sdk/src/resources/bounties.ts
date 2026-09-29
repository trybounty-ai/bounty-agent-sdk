import {
  BountyConfigurationError,
  BountyInvalidResponseError,
} from "../errors.js";
import { getBountyId } from "../events.js";
import type { HttpClient } from "../http.js";
import {
  agentBountyDetailsSchema,
  agentBountyPageSchema,
  agentEventEnvelopeSchema,
} from "../runtime-schemas.js";
import type {
  AgentBountyDetails,
  AgentBountyPage,
  AgentEvent,
  BountyListOptions,
  CallOptions,
  Work,
} from "../types.js";
import { WorkImplementation } from "../work.js";
import { z } from "zod";

export class BountiesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  list(options: BountyListOptions = {}) {
    return this.#http.json<AgentBountyPage>({
      method: "GET",
      path: "/v1/agent/bounties",
      query: {
        cursor: options.cursor,
        limit: options.limit,
        filter: options.filter,
        claim_status: options.claim_status,
      },
      signal: options.signal,
      retryable: true,
      schema: agentBountyPageSchema,
    });
  }

  async *iterate(options: BountyListOptions = {}) {
    let cursor = options.cursor;
    while (true) {
      const page = await this.list({ ...options, cursor });
      yield* page.bounties;
      if (page.is_done) return;
      if (page.next_cursor === cursor) {
        throw new BountyConfigurationError(
          "Bounty pagination did not advance its cursor",
        );
      }
      cursor = page.next_cursor;
    }
  }

  async open(
    bountyOrEvent: string | AgentEvent,
    options: CallOptions = {},
  ): Promise<Work> {
    const parsedBountyId = z.string().min(1).safeParse(bountyOrEvent);
    let bountyId: string | undefined;
    if (parsedBountyId.success) {
      bountyId = parsedBountyId.data;
    } else {
      const event = agentEventEnvelopeSchema.parse(bountyOrEvent);
      bountyId = getBountyId(event);
    }
    if (!bountyId) {
      const parsedEvent = agentEventEnvelopeSchema.safeParse(bountyOrEvent);
      const eventId = parsedEvent.success ? parsedEvent.data.id : "unknown";
      throw new BountyConfigurationError(
        `Agent event ${eventId} does not identify a Bounty`,
      );
    }
    const details = await this.#http.json<AgentBountyDetails>({
      method: "GET",
      path: `/v1/agent/bounties/${encodeURIComponent(bountyId)}`,
      signal: options.signal,
      retryable: true,
      schema: agentBountyDetailsSchema,
    });
    if (details.bounty._id !== bountyId) {
      throw new BountyInvalidResponseError(
        `Bounty returned details for ${details.bounty._id} while opening ${bountyId}`,
      );
    }
    return new WorkImplementation(this.#http, details);
  }
}
