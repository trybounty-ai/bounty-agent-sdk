import {
  BountyApiError,
  BountyConnectionError,
  BountyInvalidResponseError,
  BountyTimeoutError,
} from "./errors.js";
import { apiErrorSchema } from "./runtime-schemas.js";
import type { ZodType } from "zod";

type QueryValue = string | number | boolean | undefined;
type RequestBody = Blob | ArrayBuffer | Uint8Array | object;
const maxAutomaticRetryAfterMs = 60_000;

interface RequestArguments {
  method: "GET" | "POST" | "PUT";
  path?: string | undefined;
  url?: string | undefined;
  query?: Readonly<Record<string, QueryValue>> | undefined;
  body?: RequestBody | undefined;
  headers?: HeadersInit | undefined;
  signal?: AbortSignal | undefined;
  retryable?: boolean | undefined;
  authenticated?: boolean | undefined;
  redirect?: RequestRedirect | undefined;
}

interface JsonRequestArguments extends RequestArguments {
  schema: ZodType;
}

interface HttpClientOptions {
  apiKey: string;
  baseURL: URL;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof globalThis.fetch;
}

interface DeferredResponseLifecycle {
  cleanup(): void;
  error(cause: unknown): Error;
}

type DeferResponseCleanup = () => DeferredResponseLifecycle;

class ResponseBodyReadError extends Error {
  constructor(cause: unknown) {
    super("Could not read the Bounty API response", { cause });
    this.name = "ResponseBodyReadError";
  }
}

export class HttpClient {
  readonly #apiKey: string;
  readonly #baseURL: URL;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: HttpClientOptions) {
    this.#apiKey = options.apiKey;
    this.#baseURL = options.baseURL;
    this.#timeoutMs = options.timeoutMs;
    this.#maxRetries = options.maxRetries;
    this.#fetch = options.fetch;
  }

  async json<Result>(arguments_: JsonRequestArguments): Promise<Result> {
    const value = await this.#request(arguments_, async (response) => {
      let text: string;
      try {
        text = await response.text();
      } catch (cause) {
        throw new ResponseBodyReadError(cause);
      }
      try {
        const value: unknown = JSON.parse(text);
        return value;
      } catch (cause) {
        throw new BountyInvalidResponseError(
          `Bounty returned invalid JSON for ${arguments_.method} ${arguments_.path ?? arguments_.url ?? "request"}`,
          { cause },
        );
      }
    });
    const parsed = arguments_.schema.safeParse(value);
    if (!parsed.success) {
      throw new BountyInvalidResponseError(
        `Bounty returned an invalid response for ${arguments_.method} ${arguments_.path ?? arguments_.url ?? "request"}`,
        { cause: parsed.error },
      );
    }
    // SAFETY: Every call supplies the runtime schema for its declared Result.
    // Returning occurs only after that schema accepts the external payload.
    return parsed.data as Result;
  }

  async response(arguments_: RequestArguments): Promise<Response> {
    return await this.#request(
      arguments_,
      async (response, deferCleanup) => {
        return this.#streamingResponse(response, deferCleanup);
      },
    );
  }

  async #request<Result>(
    arguments_: RequestArguments,
    consume: (
      response: Response,
      deferCleanup: DeferResponseCleanup,
    ) => Promise<Result>,
  ): Promise<Result> {
    const url = arguments_.url
      ? new URL(arguments_.url)
      : new URL(arguments_.path ?? "", this.#baseURL);
    if (arguments_.query) {
      for (const [key, value] of Object.entries(arguments_.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers(arguments_.headers);
    headers.set("accept", "application/json");
    if (arguments_.authenticated !== false) {
      headers.set("authorization", `Bearer ${this.#apiKey}`);
    }

    let body: BodyInit | undefined;
    let hasJsonBody = false;
    if (arguments_.body instanceof Blob ||
      arguments_.body instanceof ArrayBuffer) {
      body = arguments_.body;
    } else if (arguments_.body instanceof Uint8Array) {
      body = new Uint8Array(arguments_.body);
    } else if (arguments_.body !== undefined) {
      body = JSON.stringify(arguments_.body);
      hasJsonBody = true;
    }
    if (hasJsonBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      let cleanupDeferred = false;
      let cleanedUp = false;
      let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (timeout !== undefined) globalThis.clearTimeout(timeout);
        arguments_.signal?.removeEventListener("abort", abortFromCaller);
      };
      const abortFromCaller = () => {
        controller.abort(arguments_.signal?.reason);
        cleanup();
      };
      arguments_.signal?.addEventListener("abort", abortFromCaller, {
        once: true,
      });
      if (arguments_.signal?.aborted) abortFromCaller();
      if (!cleanedUp) {
        timeout = globalThis.setTimeout(() => {
          timedOut = true;
          controller.abort();
          cleanup();
        }, this.#timeoutMs);
      }
      const deferCleanup = () => {
        cleanupDeferred = true;
        return {
          cleanup,
          error: (cause: unknown) => {
            if (arguments_.signal?.aborted) {
              return this.#abortError(arguments_.signal);
            }
            return timedOut
              ? new BountyTimeoutError(this.#timeoutMs, { cause })
              : cause instanceof Error
              ? cause
              : new BountyConnectionError(
                "Could not read the Bounty API response",
                { cause },
              );
          },
        };
      };

      try {
        let response: Response;
        const requestInit: RequestInit = {
          method: arguments_.method,
          headers,
          signal: controller.signal,
        };
        if (body !== undefined) requestInit.body = body;
        if (arguments_.redirect !== undefined) {
          requestInit.redirect = arguments_.redirect;
        }
        try {
          response = await this.#fetch(url, requestInit);
        } catch (cause) {
          if (arguments_.signal?.aborted) {
            throw this.#abortError(arguments_.signal);
          }
          if (
            arguments_.retryable &&
            attempt < this.#maxRetries
          ) {
            cleanup();
            await this.#waitBeforeRetry(attempt, arguments_.signal);
            continue;
          }
          if (timedOut) {
            throw new BountyTimeoutError(this.#timeoutMs, { cause });
          }
          throw new BountyConnectionError("Could not reach the Bounty API", {
            cause,
          });
        }

        if (response.ok) {
          try {
            return await consume(response, deferCleanup);
          } catch (cause) {
            if (arguments_.signal?.aborted) {
              throw this.#abortError(arguments_.signal);
            }
            if (timedOut) {
              throw new BountyTimeoutError(this.#timeoutMs, { cause });
            }
            if (cause instanceof ResponseBodyReadError) {
              if (arguments_.retryable && attempt < this.#maxRetries) {
                cleanup();
                await this.#waitBeforeRetry(attempt, arguments_.signal);
                continue;
              }
              throw new BountyConnectionError(cause.message, {
                cause: cause.cause,
              });
            }
            throw cause;
          }
        }

        const retryAfterMs = this.#retryAfterMs(response.headers);
        const canWaitAutomatically = retryAfterMs === undefined ||
          retryAfterMs <= maxAutomaticRetryAfterMs;
        if (
          arguments_.retryable &&
          attempt < this.#maxRetries &&
          canWaitAutomatically &&
          (response.status === 408 ||
            response.status === 429 ||
            response.status >= 500)
        ) {
          await response.body?.cancel().catch(() => undefined);
          cleanup();
          await this.#waitBeforeRetry(
            attempt,
            arguments_.signal,
            retryAfterMs,
          );
          continue;
        }

        const error = await this.#apiError(response, retryAfterMs);
        if (arguments_.signal?.aborted) {
          throw this.#abortError(arguments_.signal);
        }
        if (timedOut) {
          throw new BountyTimeoutError(this.#timeoutMs, { cause: error });
        }
        throw error;
      } finally {
        if (!cleanupDeferred) cleanup();
      }
    }
  }

  #streamingResponse(
    response: Response,
    deferCleanup: DeferResponseCleanup,
  ) {
    if (!response.body) return response;

    const reader = response.body.getReader();
    const lifecycle = deferCleanup();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      lifecycle.cleanup();
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            finish();
            controller.close();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (cause) {
          finish();
          controller.error(lifecycle.error(cause));
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    });
    try {
      const wrapped = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperties(wrapped, {
        redirected: {
          configurable: true,
          enumerable: true,
          value: response.redirected,
        },
        type: {
          configurable: true,
          enumerable: true,
          value: response.type,
        },
        url: {
          configurable: true,
          enumerable: true,
          value: response.url,
        },
      });
      return wrapped;
    } catch (cause) {
      finish();
      throw cause;
    }
  }

  async #apiError(response: Response, retryAfterMs: number | undefined) {
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      value = undefined;
    }

    const parsed = apiErrorSchema.safeParse(value);
    if (parsed.success) {
      const details = parsed.data.error.details;
      return new BountyApiError({
        status: response.status,
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        param: parsed.data.error.param,
        details,
        retryAfterMs,
      });
    }

    return new BountyApiError({
      status: response.status,
      code: "HTTP_ERROR",
      message: `Bounty request failed with status ${response.status}`,
      retryAfterMs,
    });
  }

  #retryAfterMs(headers: Headers) {
    const value = headers.get("retry-after");
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  async #waitBeforeRetry(
    attempt: number,
    signal?: AbortSignal,
    retryAfterMs?: number,
  ) {
    if (signal?.aborted) throw this.#abortError(signal);
    const exponentialDelay = Math.min(250 * 2 ** attempt, 4000);
    const delay = retryAfterMs ??
      exponentialDelay * (0.75 + Math.random() * 0.25);
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", abort);
        globalThis.clearTimeout(timer);
        resolve();
      };
      const abort = () => {
        signal?.removeEventListener("abort", abort);
        globalThis.clearTimeout(timer);
        reject(this.#abortError(signal!));
      };
      const timer = globalThis.setTimeout(finish, delay);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  #abortError(signal: AbortSignal) {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted", "AbortError");
  }
}
