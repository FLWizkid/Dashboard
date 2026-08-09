/**
 * Redaction for anything that leaves the process as a diagnostic.
 *
 * Error reports are the quietest way for private data to escape: a stack
 * frame with a token in the URL, a message quoting the row that failed, a
 * context object someone attached "just for debugging". This module is the
 * single place that decides what a report may contain.
 *
 * It runs on every report, not only when a remote reporter is configured —
 * logs on the box get the same treatment, because the box's logs are what
 * end up pasted into an issue.
 *
 * The rule when in doubt: redact. A slightly less useful stack trace costs
 * minutes; a leaked service-role key costs the database.
 */

export const REDACTED = "[redacted]";

/**
 * Keys whose *values* are never safe, whatever they contain.
 *
 * Two shapes have to be caught: snake/SCREAMING_SNAKE (`refresh_token`,
 * `SUPABASE_SERVICE_ROLE_KEY`) and camelCase (`apiKey`, `serviceRoleKey`).
 * A single case-insensitive `key` rule would also swallow `monkey`, so the
 * camelCase rule insists on the capital.
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /pass(word|wd)?/i,
  /secret/i,
  /token/i,
  /auth(orization)?/i,
  /cookie/i,
  /session/i,
  /credential/i,
  /\bjwt\b|jwt/i,
  /dsn/i,
  // Any name ending in `key` as its own word: apikey, API_KEY,
  // SUPABASE_SERVICE_ROLE_KEY, private-key.
  /(^|[_-])key$/i,
  // …and the camelCase spelling: apiKey, serviceRoleKey, anonKey.
  /[a-z0-9]Key$/,
  // Mail content, from P2. Never in a diagnostic.
  /^(body|html|text_body|snippet|preview)$/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** Patterns redacted wherever they appear in a string. */
const PATTERNS: { name: string; re: RegExp; replace: string }[] = [
  {
    // JWTs — the anon key, the service-role key, and every access token.
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replace: "[jwt]",
  },
  {
    name: "bearer",
    re: /\b(bearer)\s+[A-Za-z0-9._~+/-]+=*/gi,
    replace: "$1 [redacted]",
  },
  {
    // postgres://user:password@host — keep the shape, lose the password.
    name: "connection-string",
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi,
    replace: "$1:[redacted]@",
  },
  {
    // apikey=… / access_token=… in a query string or form body.
    name: "query-secret",
    re: /\b(api[-_]?key|access[-_]?token|refresh[-_]?token|token|password)=([^&\s"']+)/gi,
    replace: "$1=[redacted]",
  },
  {
    // Addresses identify people — the user's correspondents as much as the
    // user. The domain is kept because it is often the whole diagnostic
    // ("the corporate mailbox is failing") without naming anyone.
    name: "email",
    re: /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    replace: "[email]@$1",
  },
  {
    // age private keys, should one ever be pasted into a config by mistake.
    name: "age-key",
    re: /\bAGE-SECRET-KEY-1[0-9A-Z]+\b/g,
    replace: "[age-key]",
  },
];

/** Redacts every known secret shape from a string. */
export function scrubString(input: string): string {
  let output = input;
  for (const { re, replace } of PATTERNS) {
    output = output.replace(re, replace);
  }
  return output;
}

type ScrubOptions = {
  /** How deep to walk before collapsing. */
  maxDepth?: number;
  /** Longest string kept; anything longer is truncated, then scrubbed. */
  maxStringLength?: number;
  /** Most array entries kept. */
  maxArrayLength?: number;
};

/**
 * Deep-redacts an arbitrary value.
 *
 * Cycle-safe, depth-limited and size-limited: a context object is attached by
 * a developer in a hurry, and "the whole request" is a plausible thing for one
 * to contain.
 */
export function scrub(value: unknown, options: ScrubOptions = {}): unknown {
  const { maxDepth = 6, maxStringLength = 2048, maxArrayLength = 50 } = options;

  const seen = new WeakSet<object>();

  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || node === undefined) return node;

    if (typeof node === "string") {
      const clipped =
        node.length > maxStringLength
          ? `${node.slice(0, maxStringLength)}…[truncated ${node.length - maxStringLength} chars]`
          : node;
      return scrubString(clipped);
    }

    if (typeof node === "number" || typeof node === "boolean") return node;
    if (typeof node === "bigint") return `${node}n`;
    if (typeof node === "symbol") return node.toString();
    if (typeof node === "function") return "[function]";

    if (node instanceof Date) return node.toISOString();
    if (node instanceof Error) return scrubError(node);

    if (depth >= maxDepth) return "[depth limit]";

    if (Array.isArray(node)) {
      if (seen.has(node)) return "[circular]";
      seen.add(node);
      const kept = node.slice(0, maxArrayLength).map((v) => walk(v, depth + 1));
      if (node.length > maxArrayLength) {
        kept.push(`…${node.length - maxArrayLength} more`);
      }
      return kept;
    }

    if (typeof node === "object") {
      if (seen.has(node)) return "[circular]";
      seen.add(node);

      const out: Record<string, unknown> = {};

      // Reading a property can throw: a getter, a proxy, an ORM entity that
      // lazy-loads. The error being reported must survive a hostile context
      // object, so every access is individually guarded.
      let keys: string[];
      try {
        keys = Object.keys(node);
      } catch {
        return "[unreadable object]";
      }

      for (const key of keys) {
        if (isSensitiveKey(key)) {
          out[key] = REDACTED;
          continue;
        }
        try {
          out[key] = walk((node as Record<string, unknown>)[key], depth + 1);
        } catch {
          out[key] = "[unreadable]";
        }
      }

      return out;
    }

    return "[unknown]";
  };

  return walk(value, 0);
}

export type ScrubbedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: ScrubbedError | unknown;
};

/** Redacts an Error, including its message, stack and chained cause. */
export function scrubError(error: Error, depth = 0): ScrubbedError {
  const result: ScrubbedError = {
    name: error.name,
    message: scrubString(error.message),
  };

  if (error.stack) {
    // Keep the frames, drop anything embedded in them.
    result.stack = scrubString(error.stack);
  }

  // Chained causes are where a database driver's connection string usually
  // hides. Bounded, because a cause chain can be circular.
  if (error.cause !== undefined && depth < 4) {
    result.cause =
      error.cause instanceof Error
        ? scrubError(error.cause, depth + 1)
        : scrub(error.cause);
  }

  return result;
}
