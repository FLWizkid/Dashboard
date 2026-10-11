import type { MailAccount, MailProvider } from "./types";

/**
 * Which tint identifies a mailbox.
 *
 * ── Why a tint at all ────────────────────────────────────────────────────
 * The unified inbox is the point of this module: one list, arrival order, no
 * remembering which address a thing came to. But you still have to know which
 * identity you are about to reply from, and reading a full address on every
 * row is work. A colour answers "which of mine is this" pre-attentively —
 * before you read anything — which is exactly the load the unified list was
 * supposed to remove.
 *
 * ── The tint is never alone ──────────────────────────────────────────────
 * Every place a tint appears, the account's short name appears with it. This
 * is WCAG 1.4.1 (colour is not the only means of conveying information), and
 * it is also just necessary: two of these are blues, and nobody memorises a
 * legend for their own email.
 *
 * ── Assigned by position, not hashed ─────────────────────────────────────
 * Hashing the address gives a stable colour without a registry, and it is the
 * obvious choice — but it also gives you no control, so the day two accounts
 * collide on the same hue there is nothing to do about it. Position in the
 * account list is stable in practice (accounts are added and rarely removed),
 * survives a rename, and can be reasoned about.
 *
 * Four tints. A fifth account wraps and shares tint 1 — which is honest, and
 * better than a fifth barely-distinguishable hue that implies a difference
 * the eye cannot resolve. If five mailboxes ever becomes normal, this is the
 * function to revisit, and the wrap is deliberate rather than an oversight.
 */

export const ACCOUNT_TINTS = 4;

export type AccountTint = 1 | 2 | 3 | 4;

/** Position within `accounts` decides the tint; index 0 gets tint 1. */
export function accountTint(index: number): AccountTint {
  const wrapped = ((index % ACCOUNT_TINTS) + ACCOUNT_TINTS) % ACCOUNT_TINTS;
  return (wrapped + 1) as AccountTint;
}

/**
 * The short name shown beside the tint.
 *
 * The domain, not the local part: every one of these addresses starts with
 * "doug", so the local part is the half that carries no information. The
 * public suffix is dropped as well — "theonefor" and "encountive" differ long
 * before ".ai" and ".com" do, and a narrow column truncates from the right.
 */
export function accountShortName(account: {
  emailAddress: string;
  displayName?: string | null;
}): string {
  const domain = account.emailAddress.split("@")[1];
  if (!domain) return account.emailAddress;

  const [name] = domain.split(".");
  return name || domain;
}

/** Tailwind-safe class names. Written out because Tailwind scans literals. */
export const ACCOUNT_TEXT_CLASS: Record<AccountTint, string> = {
  1: "text-account-1",
  2: "text-account-2",
  3: "text-account-3",
  4: "text-account-4",
};

export const ACCOUNT_BG_CLASS: Record<AccountTint, string> = {
  1: "bg-account-1",
  2: "bg-account-2",
  3: "bg-account-3",
  4: "bg-account-4",
};

export const ACCOUNT_BORDER_CLASS: Record<AccountTint, string> = {
  1: "border-account-1",
  2: "border-account-2",
  3: "border-account-3",
  4: "border-account-4",
};

/**
 * Where each mailbox actually lives, in the owner's words.
 *
 * Shown on the account itself rather than on every row. It matters when
 * something is wrong — "encountive.com is Google, so a Microsoft consent
 * prompt means the account is misconfigured" is the kind of thing that costs
 * an afternoon if the interface never says which provider it is talking to.
 */
export const PROVIDER_SHORT: Record<MailProvider, string> = {
  gmail: "Google",
  microsoft: "Microsoft",
  proton_bridge: "Proton",
};

/** Index a list of accounts by id, with the tint each one earned. */
export function tintsByAccountId(
  accounts: Pick<MailAccount, "id">[],
): Map<string, AccountTint> {
  return new Map(
    accounts.map((account, index) => [account.id, accountTint(index)]),
  );
}
