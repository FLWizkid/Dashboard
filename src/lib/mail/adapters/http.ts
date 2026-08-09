/**
 * The HTTP plumbing every REST-based adapter shares.
 *
 * Its real job is turning provider-specific failure into the small vocabulary
 * the sync service reasons about — see {@link AdapterError}. "Google returned
 * 403 with reason `rateLimitExceeded`" is not something the attention card
 * should have to know; "rate limited, retry in 30s, keep showing cached mail"
 * is.
 */

import type { MailProvider } from "../types";
import { AdapterError, type AdapterErrorKind } from "./types";

export interface HttpClientOptions {
  provider: MailProvider;
  baseUrl: string;
  /** Returns a valid access token, refreshing it if necessary. */
  getAccessToken: () => Promise<string>;
  /** Injectable so tests can drive it without touching the network stack. */
  fetchImpl?: typeof fetch;
  /** Attempts for retryable failures. 1 means no retry. */
  maxAttempts?: number;
  /** Multiplied by 2^attempt for back-off. Tests set it to 0. */
  retryBaseMs?: number;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Overrides JSON encoding — Gmail's send endpoint takes raw RFC 822. */
  rawBody?: { contentType: string; content: string };
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly options: Required<Omit<HttpClientOptions, "fetchImpl">> & {
    fetchImpl: typeof fetch;
  };

  constructor(options: HttpClientOptions) {
    this.options = {
      provider: options.provider,
      baseUrl: options.baseUrl.replace(/\/$/, ""),
      getAccessToken: options.getAccessToken,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      maxAttempts: options.maxAttempts ?? 3,
      retryBaseMs: options.retryBaseMs ?? 500,
    };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(
      path.startsWith("http") ? path : `${this.options.baseUrl}${path}`,
    );

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: AdapterError | null = null;

    for (let attempt = 0; attempt < this.options.maxAttempts; attempt += 1) {
      const token = await this.options.getAccessToken();

      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      };

      let body: string | undefined;
      if (options.rawBody) {
        headers["content-type"] = options.rawBody.contentType;
        body = options.rawBody.content;
      } else if (options.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(options.body);
      }

      let response: Response;
      try {
        response = await this.options.fetchImpl(url.toString(), {
          method: options.method ?? "GET",
          headers,
          body,
          signal: options.signal,
        });
      } catch (cause) {
        // DNS failure, refused connection, TLS problem — the provider is
        // unreachable, which is explicitly a keep-showing-cached-data case.
        lastError = new AdapterError(
          this.options.provider,
          "unavailable",
          `Could not reach ${url.host}`,
          { cause },
        );
        await this.backOff(attempt, lastError);
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const error = await toAdapterError(this.options.provider, response);

      if (!RETRYABLE_STATUS.has(response.status)) throw error;

      lastError = error;
      await this.backOff(attempt, error);
    }

    throw (
      lastError ??
      new AdapterError(this.options.provider, "unknown", "Request failed")
    );
  }

  private async backOff(attempt: number, error: AdapterError): Promise<void> {
    if (attempt >= this.options.maxAttempts - 1) return;

    // Honour Retry-After when the provider sent one; it knows better than we do.
    const wait =
      error.retryAfterMs ?? this.options.retryBaseMs * Math.pow(2, attempt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Maps an HTTP failure onto the adapter's error vocabulary. */
export async function toAdapterError(
  provider: MailProvider,
  response: Response,
): Promise<AdapterError> {
  const text = await response.text().catch(() => "");
  let detail = text.slice(0, 500);
  let reason = "";

  try {
    const parsed = JSON.parse(text) as {
      error?: {
        message?: string;
        status?: string;
        errors?: { reason?: string }[];
      };
      error_description?: string;
    };
    detail = parsed.error?.message ?? parsed.error_description ?? detail;
    reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? "";
  } catch {
    /* not JSON; the truncated body is the best detail available */
  }

  const kind = classify(response.status, reason);

  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterMs = retryAfterHeader
    ? Number(retryAfterHeader) * 1000
    : undefined;

  return new AdapterError(
    provider,
    kind,
    `${response.status} from ${provider}: ${detail || response.statusText}`,
    { retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined },
  );
}

function classify(status: number, reason: string): AdapterErrorKind {
  // Tenant administrators block app access with a distinct code; treating it
  // as a generic auth failure would send the owner round the sign-in loop
  // forever instead of telling them to request consent.
  if (
    reason === "AADSTS65001" ||
    reason.includes("consent") ||
    reason === "accessNotConfigured"
  ) {
    return "admin_consent_required";
  }

  if (status === 401) return "auth";
  if (status === 403) {
    return reason.includes("rateLimit") || reason.includes("quota")
      ? "rate_limited"
      : "auth";
  }
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

/** Gmail hands back base64url with padding stripped. */
export function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
