"use client";

import { ShieldCheck } from "lucide-react";

import { useMailAccounts, useUpdateAccount } from "@/lib/mail/client";
import type { CachingPolicy } from "@/lib/mail/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * What each mailbox keeps on this machine.
 *
 * ── Why this screen exists ───────────────────────────────────────────────
 * The caching policy has been enforced in the database since P2 — a trigger
 * refuses a body under Metadata and refuses Full on a corporate account — and
 * there was no way to *set* it. The documentation described a consent flow
 * nobody could reach, so every mailbox sat on the column default whatever its
 * owner intended.
 *
 * ── Corporate is the interesting control ─────────────────────────────────
 * Marking a mailbox corporate drops it to Off and keeps it there. That is the
 * conservative reading of a governed account, and the right default when the
 * person choosing is also the person who would answer for the export: most
 * organisations' policy does not contemplate their mail being mirrored into a
 * personal database, however well encrypted.
 */

const POLICY_COPY: Record<CachingPolicy, { label: string; detail: string }> = {
  off: {
    label: "Off",
    detail: "Nothing stored locally. The mailbox is not even contacted.",
  },
  metadata: {
    label: "Metadata",
    detail: "Headers only — sender, subject, date. No bodies, no snippets.",
  },
  full: {
    label: "Full",
    detail: "Bodies mirrored and searchable, encrypted at rest.",
  },
};

export function MailboxPolicy() {
  const accounts = useMailAccounts();
  const update = useUpdateAccount();

  const list = accounts.data?.accounts ?? [];
  if (list.length === 0) return null;

  return (
    <Card className="p-5" data-testid="mailbox-policy">
      <header className="flex items-center gap-2">
        <ShieldCheck aria-hidden className="size-4 text-fg-muted" />
        <h2 className="text-sm font-semibold text-fg">What is kept locally</h2>
      </header>

      <ul role="list" className="mt-3 space-y-4">
        {list.map((account) => (
          <li key={account.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-fg">
                {account.emailAddress}
              </span>
              {account.isCorporate && <Badge tone="accent">Corporate</Badge>}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {(["off", "metadata", "full"] as const).map((policy) => {
                // Full is not offered for a corporate mailbox. Offering a
                // control the database will refuse is worse than not offering
                // it: it reads as permission, right up until the error.
                const refused = account.isCorporate && policy === "full";

                return (
                  // The shared Button rather than hand-rolled classes: its
                  // variants are the ones the contrast budget was set
                  // against, and a bespoke accent pairing here failed WCAG AA
                  // the first time it was rendered.
                  <Button
                    key={policy}
                    type="button"
                    size="sm"
                    variant={
                      account.cachingPolicy === policy ? "primary" : "ghost"
                    }
                    disabled={refused || update.isPending}
                    aria-pressed={account.cachingPolicy === policy}
                    title={
                      refused
                        ? "A corporate mailbox cannot mirror bodies here."
                        : POLICY_COPY[policy].detail
                    }
                    onClick={() =>
                      update.mutate({
                        id: account.id,
                        cachingPolicy: policy,
                      })
                    }
                  >
                    {POLICY_COPY[policy].label}
                  </Button>
                );
              })}
            </div>

            <p className="text-xs text-fg-subtle">
              {POLICY_COPY[account.cachingPolicy].detail}
            </p>

            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={account.isCorporate}
                disabled={update.isPending}
                onChange={(event) =>
                  update.mutate({
                    id: account.id,
                    isCorporate: event.target.checked,
                    // Marking it corporate takes it to Off in the same
                    // request, so there is no window in which a governed
                    // mailbox is still set to Full.
                    ...(event.target.checked
                      ? { cachingPolicy: "off" as const }
                      : {}),
                  })
                }
              />
              This is a work account governed by someone else&rsquo;s policy
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
