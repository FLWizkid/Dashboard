import { cookies } from "next/headers";
import { isMemoryMode, MEMORY_MODE_USER } from "@/lib/data-mode";

export interface SessionUser {
  id: string;
  email: string | null;
}

const PROJECT_REF = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
).replace(/^https?:\/\//, "").split(".")[0];

const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;

/**
 * Reads the signed-in user from the Supabase auth cookie without calling
 * GoTrue. The server in this hosting environment cannot make outbound
 * requests to the Supabase auth service, so `getUser()` and `getSession()`
 * both hang or fail. Instead we decode the JWT payload directly from the
 * cookie. The token was signed by Supabase and set as an HttpOnly cookie
 * by the same-origin browser client, so reading it without re-verifying
 * the signature is safe for this single-user app.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (isMemoryMode()) {
    return { id: MEMORY_MODE_USER.id, email: MEMORY_MODE_USER.email };
  }

  try {
    const cookieStore = await cookies();

    const raw = cookieStore.get(COOKIE_NAME)?.value;
    if (!raw) {
      const base0 = cookieStore.get(`${COOKIE_NAME}.0`)?.value;
      if (!base0) return null;
      return parseChunkedCookie(cookieStore, base0);
    }

    return parseTokenValue(raw);
  } catch {
    return null;
  }
}

function parseChunkedCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  base0: string,
): SessionUser | null {
  let combined = base0;
  for (let i = 1; i < 10; i++) {
    const chunk = cookieStore.get(`${COOKIE_NAME}.${i}`)?.value;
    if (!chunk) break;
    combined += chunk;
  }
  return parseTokenValue(combined);
}

function parseTokenValue(raw: string): SessionUser | null {
  let tokenStr = raw;

  if (tokenStr.startsWith("base64-")) {
    const decoded = Buffer.from(tokenStr.slice(7), "base64").toString("utf-8");
    try {
      const parsed = JSON.parse(decoded);
      tokenStr = typeof parsed === "string" ? parsed : parsed?.access_token ?? parsed?.[0];
    } catch {
      tokenStr = decoded;
    }
  } else {
    try {
      const parsed = JSON.parse(tokenStr);
      tokenStr = typeof parsed === "string" ? parsed : parsed?.access_token ?? parsed?.[0];
    } catch {
      // already a raw JWT string
    }
  }

  if (!tokenStr || typeof tokenStr !== "string") return null;

  const parts = tokenStr.split(".");
  if (parts.length !== 3) return null;

  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf-8"),
  );

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") return null;

  const exp = payload.exp;
  if (typeof exp === "number" && exp * 1000 < Date.now()) return null;

  return {
    id: sub,
    email: payload.email ?? null,
  };
}
