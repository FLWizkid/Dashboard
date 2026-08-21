"use client";

import {
  AlertCircle,
  ChevronLeft,
  Mail,
  Paperclip,
  Search,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  useMailAccounts,
  useMarkRead,
  useRateSender,
  useThread,
  useThreads,
} from "@/lib/mail/client";
import {
  ACCOUNT_BG_CLASS,
  accountShortName,
  tintsByAccountId,
  type AccountTint,
} from "@/lib/mail/account-colour";
import type { ThreadSummary } from "@/lib/mail/repository";
import {
  PROVIDER_LABELS,
  SENDER_IMPORTANCE_LABELS,
  displayFor,
  type Message,
  type SenderImportance,
} from "@/lib/mail/types";
import { readableBody } from "@/lib/mail/readable";
import { cn } from "@/lib/utils";

import { AccountMark, AccountRail } from "@/components/mail/account-mark";
import { ConnectProton } from "@/components/mail/connect-proton";
import { CreateTaskFromMail } from "@/components/mail/create-task-from-mail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The unified inbox.
 *
 * ── One list, not three tabs ─────────────────────────────────────────────
 * Every connected account at once, sorted by arrival. Per-account tabs make
 * you remember which mailbox a thing came to, which is exactly the work this
 * module exists to remove. The account is marked on each row instead — a tint
 * rail and its name, see account-mark.tsx — because you still need to know
 * which identity you would be replying from.
 *
 * The filter above the list is the escape hatch, not the organising idea. It
 * exists for "show me only the personal account for ten minutes", starts at
 * All, and is not remembered between visits: a filter that persists is how
 * you end up believing an account has gone quiet when it is merely hidden.
 *
 * ── Importance is the sort you actually want ─────────────────────────────
 * Critical senders rise to the top of the list regardless of age, because "the
 * board chair wrote three hours ago" outranks "a newsletter arrived a minute
 * ago". Everything else is chronological.
 */

const IMPORTANCE_TONE: Record<
  SenderImportance,
  "critical" | "high" | "normal" | "low"
> = {
  critical: "critical",
  high: "high",
  normal: "normal",
  low: "low",
};

export function EmailView() {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);

  const accounts = useMailAccounts();
  const threads = useThreads({
    q: query.trim() || undefined,
    unreadOnly: unreadOnly || undefined,
  });
  const thread = useThread(selected);
  const markRead = useMarkRead();

  const connected = useMemo(
    () => accounts.data?.accounts ?? [],
    [accounts.data],
  );

  // Tints are assigned by position in this list, so they have to be derived
  // from the accounts and not from anything on the thread itself.
  const tints = useMemo(() => tintsByAccountId(connected), [connected]);

  /**
   * Changing the filter closes whatever was open.
   *
   * Otherwise filtering to the personal account leaves a work thread sitting
   * in the reading pane, no longer present in the list beside it. The pane is
   * the thing you reply from, so a stale one there is the exact mistake the
   * account marks exist to prevent.
   */
  const chooseAccount = (next: string | null) => {
    setAccountFilter((current) => (current === next ? null : next));
    setSelected(null);
  };

  const list = useMemo(() => {
    const rows = threads.data?.threads ?? [];
    const visible = accountFilter
      ? rows.filter((row) => row.accountId === accountFilter)
      : rows;

    // Critical first, then by recency. A stable, total order so the list does
    // not reshuffle under the reader between refetches.
    return [...visible].sort((a, b) => {
      const byImportance = rank(a.senderImportance) - rank(b.senderImportance);
      if (byImportance !== 0) return byImportance;
      return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
    });
  }, [threads.data, accountFilter]);

  // Opening a thread marks it read — but only once its messages are known,
  // because "read" is a fact about specific messages and the summary does not
  // carry their ids. Guarded by a ref so a refetch does not re-issue the write
  // in a loop.
  const markedRef = useRef<string | null>(null);
  const loaded = thread.data;

  useEffect(() => {
    if (!loaded) return;

    const unread = loaded.messages.filter((m) => !m.isRead).map((m) => m.id);
    if (unread.length === 0) return;
    if (markedRef.current === loaded.thread.id) return;

    markedRef.current = loaded.thread.id;
    markRead.mutate({ messageIds: unread, read: true });
  }, [loaded, markRead]);

  if (accounts.isSuccess && connected.length === 0) {
    return <NothingConnected providers={accounts.data.providers} />;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Email</h1>
          <p className="text-sm text-fg-muted">
            {connected.length === 1
              ? connected[0].emailAddress
              : `${connected.length} accounts, one list`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search mail</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-9 w-48 rounded-md border border-line bg-surface pl-8 pr-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <Button
            type="button"
            variant={unreadOnly ? "primary" : "ghost"}
            size="sm"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((on) => !on)}
          >
            Unread
          </Button>
        </div>
      </header>

      {/* One account at a time, when you want it. Hidden entirely with a
          single mailbox, where "All" and the only account say the same thing
          and the row would be pure furniture. */}
      {connected.length > 1 ? (
        <div
          role="group"
          aria-label="Filter by account"
          data-testid="account-filter"
          className="flex flex-wrap items-center gap-1.5"
        >
          <FilterChip
            active={accountFilter === null}
            onClick={() => chooseAccount(null)}
            testId="account-filter-all"
          >
            {/* "All accounts", not "All mail": the back button on a phone is
                already called All mail, and two controls with the same name on
                one screen is an ambiguity for anyone navigating by label. */}
            All accounts
          </FilterChip>

          {connected.map((account) => (
            <FilterChip
              key={account.id}
              active={accountFilter === account.id}
              onClick={() => chooseAccount(account.id)}
              testId={`account-filter-${account.id}`}
            >
              <AccountMark
                tint={tints.get(account.id) ?? 1}
                name={accountShortName(account)}
                provider={account.provider}
              />
            </FilterChip>
          ))}
        </div>
      ) : null}

      {/* Master–detail on a phone, two panes on a desktop.

          Stacking the list above an empty "choose a thread" card is what a
          naive responsive grid does, and it wastes the half of a phone screen
          that matters. Below `lg` exactly one of the two is mounted: the list,
          or the thread with a way back. */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0", selected !== null && "hidden lg:block")}>
          <ThreadList
            threads={list}
            tints={tints}
            selected={selected}
            loading={threads.isPending}
            onOpen={(summary) => setSelected(summary.id)}
          />
        </div>

        <div className={cn("min-h-0", selected === null && "hidden lg:block")}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-2 lg:hidden"
            onClick={() => setSelected(null)}
          >
            <ChevronLeft aria-hidden className="size-4" />
            All mail
          </Button>

          <ThreadPane
            data={thread.data}
            tints={tints}
            loading={thread.isPending && selected !== null}
            empty={selected === null}
          />
        </div>
      </div>
    </div>
  );
}

function rank(importance: SenderImportance): number {
  return { critical: 0, high: 1, normal: 2, low: 3 }[importance];
}

/**
 * One account filter.
 *
 * `aria-pressed` rather than a radio group: these are toggles that happen to
 * be mutually exclusive in practice, and pressing the active one clears the
 * filter rather than doing nothing — which is what a radio would do, and is
 * the wrong answer when the control is also how you get back to All.
 */
function FilterChip({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        // The 24px raycast floor, with the same headroom the task rows got.
        "inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary-soft text-primary-soft-fg"
          : "border-line text-fg-muted hover:bg-surface-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/* ── The list ───────────────────────────────────────────────────────────── */

function ThreadList({
  threads,
  tints,
  selected,
  loading,
  onOpen,
}: {
  threads: ThreadSummary[];
  tints: Map<string, AccountTint>;
  selected: string | null;
  loading: boolean;
  onOpen: (thread: ThreadSummary) => void;
}) {
  if (loading) {
    return (
      <Card className="p-4 text-sm text-fg-muted" aria-busy>
        Loading mail…
      </Card>
    );
  }

  if (threads.length === 0) {
    return (
      <Card className="p-4 text-sm text-fg-muted" data-testid="mail-empty">
        Nothing matches.
      </Card>
    );
  }

  return (
    <Card className="min-h-0 overflow-y-auto p-0">
      <ul
        role="list"
        className="divide-y divide-line"
        data-testid="thread-list"
      >
        {threads.map((thread) => (
          <li key={thread.id} className="relative">
            {/* The rail sits on the <li> rather than inside the button, so it
                spans the full row height whatever the row contains. */}
            <AccountRail tint={tints.get(thread.accountId) ?? 1} />

            <button
              type="button"
              onClick={() => onOpen(thread)}
              aria-current={selected === thread.id}
              data-testid="thread-row"
              className={cn(
                // `pl-5` rather than `pl-4`: the rail owns the first three
                // pixels and text butted against it reads as a mistake.
                "flex w-full flex-col gap-1 py-3 pl-5 pr-4 text-left transition-colors",
                "hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selected === thread.id && "bg-surface-muted",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
                    thread.unreadCount > 0
                      ? "font-semibold text-fg"
                      : "text-fg-muted",
                  )}
                >
                  {thread.from.name ?? thread.from.address}
                </span>

                {thread.senderImportance !== "normal" && (
                  <Badge tone={IMPORTANCE_TONE[thread.senderImportance]}>
                    {SENDER_IMPORTANCE_LABELS[thread.senderImportance]}
                  </Badge>
                )}

                {thread.hasAttachments && (
                  <Paperclip
                    aria-label="Has attachments"
                    className="size-3 text-fg-subtle"
                  />
                )}

                <time
                  className="ml-auto shrink-0 text-xs text-fg-muted"
                  dateTime={thread.lastMessageAt ?? undefined}
                >
                  {shortTime(thread.lastMessageAt)}
                </time>
              </span>

              <span className="truncate text-sm text-fg">
                {thread.subject ?? "(no subject)"}
              </span>

              <span className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="truncate">{thread.snippet ?? ""}</span>
              </span>

              {/* Which identity you would be replying from. The short name
                  rather than the full address: at this width the address
                  truncates, and it truncates from the right, which is where
                  the distinguishing part of these three happens to live. */}
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                <AccountMark
                  tint={tints.get(thread.accountId) ?? 1}
                  name={accountShortName({
                    emailAddress: thread.accountAddress,
                  })}
                />
                {thread.messageCount > 1 ? (
                  <span>· {thread.messageCount} messages</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── The thread ─────────────────────────────────────────────────────────── */

function ThreadPane({
  data,
  tints,
  loading,
  empty,
}: {
  data?: { thread: ThreadSummary; messages: Message[] };
  tints: Map<string, AccountTint>;
  loading: boolean;
  empty: boolean;
}) {
  const rateSender = useRateSender();

  if (empty) {
    return (
      <Card className="flex items-center justify-center p-8 text-sm text-fg-muted">
        <span className="flex items-center gap-2">
          <Mail aria-hidden className="size-4" />
          Choose a thread.
        </span>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card className="p-4 text-sm text-fg-muted" aria-busy>
        Loading…
      </Card>
    );
  }

  return (
    <Card className="min-h-0 overflow-y-auto p-0" data-testid="thread-pane">
      {/* The rail again, along the top of the pane. Opening a thread should
          not lose the one signal that said which mailbox you are in — this is
          the moment before a reply, which is exactly when sending from the
          wrong identity costs something. */}
      <span
        aria-hidden="true"
        className={cn(
          "block h-[3px] w-full",
          ACCOUNT_BG_CLASS[tints.get(data.thread.accountId) ?? 1],
        )}
      />

      <header className="border-b border-line px-5 py-4">
        <h2 className="text-base font-semibold text-fg">
          {data.thread.subject ?? "(no subject)"}
        </h2>
        {/* The full address here, where there is room for it. The list shows
            the short name; this is where you check it before replying. */}
        <p
          className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted"
          data-testid="thread-account"
        >
          <AccountMark
            tint={tints.get(data.thread.accountId) ?? 1}
            name={data.thread.accountAddress}
          />
          <span aria-hidden>·</span>
          <span>{PROVIDER_LABELS[data.thread.provider]}</span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">
            {data.thread.from.address}
          </span>
          {(["critical", "high", "normal", "low"] as const).map((level) => (
            <Button
              key={level}
              type="button"
              size="sm"
              variant={
                data.thread.senderImportance === level ? "primary" : "ghost"
              }
              aria-pressed={data.thread.senderImportance === level}
              onClick={() =>
                rateSender.mutate({
                  address: data.thread.from.address,
                  importance: level,
                })
              }
            >
              {SENDER_IMPORTANCE_LABELS[level]}
            </Button>
          ))}
        </div>
      </header>

      <ol role="list" className="divide-y divide-line">
        {data.messages.map((message) => (
          <li
            key={message.id}
            className="px-5 py-4"
            data-testid="thread-message"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-fg">
                {displayFor(message.from)}
              </span>
              {message.isFlagged && (
                <Star aria-label="Flagged" className="size-3 text-accent" />
              )}
              <time
                className="ml-auto text-xs text-fg-muted"
                dateTime={message.receivedAt}
              >
                {longTime(message.receivedAt)}
              </time>
            </div>

            <MessageBody message={message} />
            <CreateTaskFromMail messageId={message.id} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * A message's body, or an honest account of why there isn't one.
 *
 * Under the Metadata policy no body was ever stored, and rendering an empty
 * pane would look like an empty email. Saying which setting caused it — and
 * that it is a setting, not a failure — is the difference between a product
 * that seems broken and one that seems deliberate.
 */
function MessageBody({ message }: { message: Message }) {
  // HTML bodies are reduced to their text before they reach the DOM. The
  // markup is never rendered — see src/lib/mail/readable.ts for why showing
  // a sender's HTML is a decision this product has not taken.
  const text = readableBody(message.body, message.bodyFormat);

  if (text) {
    return <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{text}</p>;
  }

  return (
    <p
      className="mt-2 flex items-start gap-2 text-sm text-fg-muted"
      data-testid="body-withheld"
    >
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        This account stores metadata only, so the body was never kept.{" "}
        {message.snippet && <em>“{message.snippet}”</em>}
      </span>
    </p>
  );
}

/* ── Nothing connected ──────────────────────────────────────────────────── */

function NothingConnected({
  providers,
}: {
  providers: { provider: string; configured: boolean; reason?: string }[];
}) {
  return (
    <Card className="p-6" data-testid="mail-not-connected">
      <h1 className="text-lg font-semibold text-fg">No mail connected</h1>
      <p className="mt-1 max-w-prose text-sm text-fg-muted">
        Connect an account and its mail is synced to this box and encrypted at
        rest. Nothing is sent anywhere else.
      </p>

      <ul role="list" className="mt-4 space-y-2">
        {providers.map((provider) => (
          <li
            key={provider.provider}
            className="flex items-center justify-between gap-4 rounded-md border border-line px-3 py-2"
          >
            <span className="text-sm text-fg">
              {
                PROVIDER_LABELS[
                  provider.provider as keyof typeof PROVIDER_LABELS
                ]
              }
            </span>

            {provider.provider === "proton_bridge" ? (
              // Proton is not OAuth and never was. This row used to offer a
              // Connect button pointing at the OAuth start route, which
              // answers "unknown provider" — a button that could not work.
              // The form below is the actual flow.
              <span className="text-xs text-fg-muted">Set up below</span>
            ) : provider.configured ? (
              <Button asChild size="sm">
                <a href={`/api/mail/oauth/${provider.provider}/start`}>
                  Connect
                </a>
              </Button>
            ) : (
              // Listed but not offered. Hiding it would suggest the product
              // cannot do this; a button that fails would be worse.
              <span className="text-xs text-fg-subtle">
                {provider.reason ?? "Not configured on this box"}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <ConnectProton />
      </div>
    </Card>
  );
}

/* ── Time ───────────────────────────────────────────────────────────────── */

function shortTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function longTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
