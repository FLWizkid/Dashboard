"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { createClient } from "@/lib/supabase/client";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = React.useState<{
    checked: boolean;
    email: string | null;
  }>({ checked: false, email: null });

  React.useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setState({ checked: true, email: session.user.email ?? null });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (!state.checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-fg-muted">Loading...</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={state.email}>
      {children}
    </AuthContext.Provider>
  );
}

const AuthContext = React.createContext<string | null>(null);

export function useAuthEmail(): string | null {
  return React.useContext(AuthContext);
}
