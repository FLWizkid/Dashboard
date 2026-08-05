import { isMemoryMode, MEMORY_MODE_USER } from "@/lib/data-mode";
import { createClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, or `null`.
 *
 * Always `getUser()` rather than `getSession()`: the former revalidates the
 * token with GoTrue, the latter trusts a cookie the browser could have been
 * handed anything in.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (isMemoryMode()) {
    return { id: MEMORY_MODE_USER.id, email: MEMORY_MODE_USER.email };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? { id: user.id, email: user.email ?? null } : null;
}
