import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Temporary: password-free sign-in for the single owner account. Delete this function to require passwords again.
const OWNER_EMAIL = "doug@theonefor.ai";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: OWNER_EMAIL });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) return json({ error: "Could not open the console right now." }, 500);
    return json({ token_hash: tokenHash });
  } catch {
    return json({ error: "Could not open the console right now." }, 500);
  }
});
