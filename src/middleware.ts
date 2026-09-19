import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  return updateSession(request, requestHeaders);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/health).*)"],
};
