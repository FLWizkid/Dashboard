"use client";

import {
  ACCOUNT_BG_CLASS,
  ACCOUNT_TEXT_CLASS,
  PROVIDER_SHORT,
  type AccountTint,
} from "@/lib/mail/account-colour";
import type { MailProvider } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

/**
 * Which of your mailboxes a thing arrived at.
 *
 * ── Why not group the list by account ────────────────────────────────────
 * Grouping under per-account headings was the other option, and it is worse
 * for the job this inbox does. Grouping imposes a second sort: within a group
 * you get time order, but across groups you get account order, so "what came
 * in most recently" stops being answerable by looking at the top. It also
 * makes an empty mailbox occupy a heading, and it fights the importance sort
 * that already moves critical senders to the front.
 *
 * A per-row mark keeps one chronological list — the thing the module exists
 * for — and answers "which of mine is this" without a heading, a scroll or a
 * filter. Every serious multi-account client that kept a unified view landed
 * here for the same reason.
 *
 * ── The mark is a rail and a name, not a colour ──────────────────────────
 * The tint on its own would fail anyone who cannot separate these hues, and
 * would fail everyone on the day a fourth account is added. The name is
 * always present; the tint just makes it findable without reading.
 */
export function AccountMark({
  tint,
  name,
  provider,
  className,
}: {
  tint: AccountTint;
  name: string;
  /** Shown only where there is room for it — the list is not the place. */
  provider?: MailProvider;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", ACCOUNT_BG_CLASS[tint])}
      />
      <span className={cn("truncate", ACCOUNT_TEXT_CLASS[tint])}>{name}</span>
      {provider ? (
        <span className="text-fg-subtle">· {PROVIDER_SHORT[provider]}</span>
      ) : null}
    </span>
  );
}

/**
 * The coloured edge down the leading side of a row.
 *
 * Three pixels, full height, and the reason the tint works at a glance: a dot
 * has to be found before it can be read, whereas a rail is already where the
 * eye enters the row. Purely decorative — `AccountMark` carries the name that
 * makes it meaningful.
 */
export function AccountRail({ tint }: { tint: AccountTint }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-y-0 left-0 w-[3px]",
        ACCOUNT_BG_CLASS[tint],
      )}
    />
  );
}
