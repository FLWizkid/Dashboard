import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Reads the public URL + anon key from the
 * environment. These are safe to expose to the client; Row Level Security
 * is what protects the data on the self-hosted instance.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
