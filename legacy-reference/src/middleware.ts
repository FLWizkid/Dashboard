import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Passthrough middleware.
 *
 * The Supabase session-refresh middleware (`updateSession`) makes a network
 * call to GoTrue on every request. In this hosting environment the Edge
 * runtime cannot reach external services, so that call hangs indefinitely
 * and the page never loads. Auth cookies set by the sign-in server action
 * are read directly by `getSessionUser` in the dashboard layout instead.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/health).*)"],
};
