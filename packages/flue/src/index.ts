import {
  createChannelRouter,
  type ChannelRouteDefinition,
  type JsonValue,
} from "@flue/runtime";
import {
  BountyWebhookError,
  getBountyId,
  verifyWebhook,
  type AgentEvent,
  type VerifyBountyWebhookOptions,
} from "@bounty-ai/agent-sdk";
import type { Context, Env, Hono } from "hono";
import { z } from "zod";

const webhookSecretsSchema = z.union([
  z.string().min(1).transform((secret) => [secret]),
  z.array(z.string().min(1)).min(1),
]);
const webhookHandlerSchema = z.function();
const conversationRefSchema = z.object({
  agentId: z.string().min(1),
  bountyId: z.string().min(1),
});

export class InvalidBountyInputError extends TypeError {
  readonly field: string;

  constructor(field: string) {
    super(`Invalid Bounty channel input: ${field}.`);
    this.name = "InvalidBountyInputError";
    this.field = field;
  }
}

export class InvalidBountyInstanceIdError extends TypeError {
  constructor() {
    super("Invalid Bounty instance id.");
    this.name = "InvalidBountyInstanceIdError";
  }
}

export interface BountyConversationRef {
  agentId: string;
  bountyId: string;
}

export type BountyHandlerValue = undefined | JsonValue | Response;
export type BountyHandlerResult =
  | BountyHandlerValue
  | void
  | Promise<BountyHandlerValue | void>;

export interface BountyWebhookHandlerInput<E extends Env = Env> {
  c: Context<E>;
  event: AgentEvent;
  /** Signed Bounty event ID. Use this as Flue's dispatch idempotency key. */
  deliveryId: string;
  /** Present for free-form Bounty events. */
  bountyId: string | undefined;
}

export interface BountyChannelOptions<E extends Env = Env> {
  webhookSecret: string | readonly string[];
  /** Maximum request body size. Defaults to the SDK's 1 MiB limit. */
  bodyLimit?: number;
  /** Accepted clock skew in seconds. Defaults to 300. */
  toleranceSeconds?: number;
  webhook(input: BountyWebhookHandlerInput<E>): BountyHandlerResult;
}

export interface BountyChannel<E extends Env = Env> {
  readonly routes: readonly ChannelRouteDefinition<E>[];
  route(): Hono<E>;
  instanceId(ref: BountyConversationRef): string;
  parseInstanceId(id: string): BountyConversationRef;
}

/**
 * Create verified Bounty webhook ingress for a Flue application.
 * @deprecated `@bounty-ai/flue` gets no new features. Verify webhooks with
 * `bounty.webhooks.verify()` from `@bounty-ai/agent-sdk` instead.
 */
export function createBountyChannel<E extends Env = Env>(
  options: BountyChannelOptions<E>,
): BountyChannel<E> {
  const parsedSecrets = webhookSecretsSchema.safeParse(options?.webhookSecret);
  if (!parsedSecrets.success) {
    throw new TypeError("createBountyChannel() requires a non-empty webhookSecret.");
  }
  if (!webhookHandlerSchema.safeParse(options?.webhook).success) {
    throw new TypeError("createBountyChannel() requires a webhook handler.");
  }
  if (
    options.bodyLimit !== undefined &&
    (!Number.isSafeInteger(options.bodyLimit) || options.bodyLimit <= 0)
  ) {
    throw new TypeError("Bounty bodyLimit must be a positive integer.");
  }
  if (
    options.toleranceSeconds !== undefined &&
    (!Number.isFinite(options.toleranceSeconds) || options.toleranceSeconds < 0)
  ) {
    throw new TypeError("Bounty toleranceSeconds must be finite and nonnegative.");
  }

  const routes: readonly ChannelRouteDefinition<E>[] = [{
    method: "POST",
    path: "/webhook",
    handler: async (c) => {
      const contentType = c.req.raw.headers.get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") return c.body(null, 415);

      try {
        const verifyOptions: VerifyBountyWebhookOptions = {
          secret: options.webhookSecret,
        };
        if (options.bodyLimit !== undefined) {
          verifyOptions.maxBodyBytes = options.bodyLimit;
        }
        if (options.toleranceSeconds !== undefined) {
          verifyOptions.toleranceSeconds = options.toleranceSeconds;
        }
        const event = await verifyWebhook(c.req.raw, verifyOptions);
        const bountyId = getBountyId(event);
        const value = await options.webhook({
          c,
          event,
          deliveryId: event.id,
          bountyId,
        });
        if (value === undefined) return c.body(null, 200);
        if (value instanceof Response) return value;
        return Response.json(value);
      } catch (error) {
        if (!(error instanceof BountyWebhookError)) throw error;
        if (error.reason === "payload_too_large") return c.body(null, 413);
        if (
          error.reason === "invalid_signature" ||
          error.reason === "invalid_signature_format" ||
          error.reason === "timestamp_out_of_tolerance"
        ) {
          return c.body(null, 401);
        }
        return c.body(null, 400);
      }
    },
  }];

  const channel: BountyChannel<E> = {
    routes,
    route: () => createChannelRouter(routes),
    instanceId(ref) {
      const parsedRef = conversationRefSchema.safeParse(ref);
      if (!parsedRef.success) throw new InvalidBountyInputError("conversation");
      return [
        "bounty",
        "v1",
        "agent",
        encodeURIComponent(parsedRef.data.agentId),
        "bounty",
        encodeURIComponent(parsedRef.data.bountyId),
      ].join(":");
    },
    parseInstanceId(id) {
      try {
        const match = /^bounty:v1:agent:([^:]+):bounty:([^:]+)$/.exec(id);
        if (!match?.[1] || !match[2]) throw new InvalidBountyInstanceIdError();
        const ref = {
          agentId: decodeURIComponent(match[1]),
          bountyId: decodeURIComponent(match[2]),
        };
        if (channel.instanceId(ref) !== id) {
          throw new InvalidBountyInstanceIdError();
        }
        return ref;
      } catch (error) {
        if (error instanceof InvalidBountyInstanceIdError) throw error;
        throw new InvalidBountyInstanceIdError();
      }
    },
  };

  return channel;
}

export type { AgentEvent, JsonValue };
