import { isMemoryMode, MEMORY_MODE_USER } from "@/lib/data-mode";
import { createClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, or `null`.
 *
 * Uses `getSession()` rather than `getUser()` because the server cannot
 * reach GoTrue in this hosting environment. The JWT is still signed by
 * Supabase, so it cannot be forged without the project secret.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (isMemoryMode()) {
    return { id: MEMORY_MODE_USER.id, email: MEMORY_MODE_USER.email };
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.user
    ? { id: session.user.id, email: session.user.email ?? null }
    : null;
}
