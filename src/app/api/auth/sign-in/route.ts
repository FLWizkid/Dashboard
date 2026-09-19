import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    if (signInError.message === "Invalid login credentials") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        return NextResponse.json(
          { error: signUpError.message },
          { status: 400 },
        );
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: signInError.message },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true });
}
