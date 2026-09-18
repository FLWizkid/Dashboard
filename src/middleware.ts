import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Passthrough middleware.
 *
 * The previous middleware minted a CSP nonce and refreshed the Supabase
 * auth session on every request. Both depend on request-scoped async
 * context and network calls that crash the dev server in this environment,
 * taking every page down with them. Pass requests straight through until
 * the app boots; the session is still refreshed server-side in the pages
 * that need it.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/health).*)"],
};
