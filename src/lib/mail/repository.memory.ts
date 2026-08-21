import { randomUUID } from "node:crypto";

import {
  MailAccountNotFoundError,
  MessageNotFoundError,
  PolicyForbidsError,
  type EventQuery,
  type MailRepository,
  type ThreadQuery,
  type ThreadSummary,
} from "./repository";
import { policyAllowsBodies, policyAllowsStorage } from "./sync";
import {
  SENDER_IMPORTANCE_RANK,
  type Calendar,
  type CalendarEvent,
  type MailAccount,
  type Mailbox,
  type Message,
  type Sender,
  type SenderImportance,
} from "./types";

/**
 * In-process mail and calendar, for end-to-end tests.
 *
 * **It enforces the database's rules, not merely its shape.** The caching
 * policy is a trigger on the box: Off stores nothing, Metadata refuses a body,
 * Full needs recorded consent for a corporate account. A fake that happily
 * returned bodies under Metadata would let an E2E suite prove a guarantee the
 * real system does not make — which is a statement about nothing.
 */

/*
 * The three real mailboxes, each reached through the provider that actually
 * hosts it. Getting this wrong is not cosmetic: the provider decides which
 * API is called, which consent screen appears, and which scopes are asked
 * for, so a mailbox pointed at the wrong one fails at authorisation with an
 * error that reads like a permissions problem.
 *
 *   theonefor.ai   GoDaddy resells Microsoft 365, so the mailbox is M365 and
 *                  Graph is the right API despite the domain being bought
 *                  somewhere else entirely.
 *   encountive.com Domain and website at SiteGround, which forwards mail on
 *                  to Google Workspace. Google is where the mailbox lives, so
 *                  Google is what this connects to. It was Microsoft here
 *                  until the owner corrected it; it never was one.
 *   proton.me      Personal. Proton has no sync API, so this goes through
 *                  Bridge over local IMAP — see adapters/proton.ts.
 *
 * Nothing is migrated by any of this. Each provider stays the system of
 * record for its own mail; the app is a client, and the local mirror is a
 * cache governed by the per-account policy below.
 */
const ACCOUNT_ID = "acc-m365-theonefor";
const SECOND_ACCOUNT_ID = "acc-proton";
const THIRD_ACCOUNT_ID = "acc-google-encountive";

interface State {
  accounts: MailAccount[];
  mailboxes: Mailbox[];
  messages: (Message & { threadKey: string })[];
  senders: Sender[];
  calendars: Calendar[];
  events: CalendarEvent[];
}

function seed(): State {
  const now = Date.now();
  const at = (minutesAgo: number) =>
    new Date(now - minutesAgo * 60_000).toISOString();

  const accounts: MailAccount[] = [
    {
      id: ACCOUNT_ID,
      provider: "microsoft",
      remoteId: "m365-theonefor",
      emailAddress: "doug@theonefor.ai",
      displayName: "Doug — theonefor.ai (primary)",
      status: "connected",
      statusDetail: null,
      cachingPolicy: "full",
      isCorporate: false,
      adminConsent: "not_required",
      retentionMonths: 24,
      syncMailEnabled: true,
      syncCalendarEnabled: true,
      hasCredentials: true,
      lastSyncAt: at(4),
      lastSuccessAt: at(4),
      lastError: null,
      lastErrorAt: null,
      createdAt: at(60 * 24 * 30),
    },
    {
      id: THIRD_ACCOUNT_ID,
      provider: "gmail",
      remoteId: "google-encountive",
      emailAddress: "doug@encountive.com",
      displayName: "Doug — encountive.com",
      status: "connected",
      statusDetail: null,
      // Full, and not corporate: this is the owner's own Workspace, so there
      // is no second organisation's policy to respect and no reason to give
      // up local search over it. Compare the Proton account below, which is
      // Metadata for a reason that actually applies to it.
      cachingPolicy: "full",
      isCorporate: false,
      adminConsent: "not_required",
      retentionMonths: 24,
      syncMailEnabled: true,
      syncCalendarEnabled: true,
      hasCredentials: true,
      lastSyncAt: at(11),
      lastSuccessAt: at(11),
      lastError: null,
      lastErrorAt: null,
      createdAt: at(60 * 24 * 21),
    },
    {
      id: SECOND_ACCOUNT_ID,
      provider: "proton_bridge",
      remoteId: "proton-1",
      emailAddress: "dougtully@proton.me",
      displayName: "Doug — personal",
      status: "connected",
      statusDetail: null,
      // Deliberately Metadata, so the E2E suite exercises the refusal path.
      cachingPolicy: "metadata",
      isCorporate: false,
      adminConsent: "not_required",
      retentionMonths: 24,
      syncMailEnabled: true,
      syncCalendarEnabled: false,
      hasCredentials: true,
      lastSyncAt: at(9),
      lastSuccessAt: at(9),
      lastError: null,
      lastErrorAt: null,
      createdAt: at(60 * 24 * 10),
    },
  ];

  const mailboxes: Mailbox[] = [
    {
      id: "mb-inbox",
      accountId: ACCOUNT_ID,
      remoteId: "INBOX",
      name: "Inbox",
      kind: "inbox",
      unreadCount: 2,
      totalCount: 3,
      syncEnabled: true,
      position: 0,
    },
    {
      id: "mb-sent",
      accountId: ACCOUNT_ID,
      remoteId: "SENT",
      name: "Sent",
      kind: "sent",
      unreadCount: 0,
      totalCount: 1,
      syncEnabled: true,
      position: 1,
    },
    {
      id: "mb-encountive-inbox",
      accountId: THIRD_ACCOUNT_ID,
      remoteId: "INBOX",
      name: "Inbox",
      kind: "inbox",
      unreadCount: 1,
      totalCount: 2,
      syncEnabled: true,
      position: 0,
    },
    {
      id: "mb-proton-inbox",
      accountId: SECOND_ACCOUNT_ID,
      remoteId: "INBOX",
      name: "Inbox",
      kind: "inbox",
      unreadCount: 1,
      totalCount: 1,
      syncEnabled: true,
      position: 0,
    },
  ];

  const message = (
    over: Partial<Message> & { id: string; threadKey: string },
  ): Message & { threadKey: string } => ({
    accountId: ACCOUNT_ID,
    threadId: over.threadKey,
    mailboxId: "mb-inbox",
    remoteId: over.id,
    messageIdHeader: `<${over.id}@example.test>`,
    subject: "No subject",
    snippet: null,
    from: { address: "someone@example.test", name: "Someone" },
    to: ["doug@theonefor.ai"],
    cc: [],
    sentAt: at(30),
    receivedAt: at(30),
    isRead: false,
    isFlagged: false,
    isDraft: false,
    hasAttachments: false,
    body: null,
    bodyFormat: null,
    senderImportance: "normal",
    ...over,
  });

  const messages = [
    message({
      id: "msg-board",
      threadKey: "thr-board",
      subject: "Board pack for Thursday",
      snippet: "Can you review the security section before Thursday?",
      from: { address: "chair@board.example", name: "Priya Raman" },
      body: "Can you review the security section before Thursday?\n\nThe auditors flagged two items and I would rather we had an answer.",
      bodyFormat: "text",
      senderImportance: "critical",
      receivedAt: at(25),
      sentAt: at(25),
    }),
    message({
      id: "msg-vendor",
      threadKey: "thr-vendor",
      subject: "Okta renewal — pricing",
      snippet: "Attaching the revised quote.",
      from: { address: "sales@vendor.example", name: "Vendor Sales" },
      body: "Attaching the revised quote. Let me know by the 1st.",
      bodyFormat: "text",
      hasAttachments: true,
      senderImportance: "normal",
      receivedAt: at(180),
      sentAt: at(180),
    }),
    message({
      id: "msg-reply",
      threadKey: "thr-board",
      subject: "Re: Board pack for Thursday",
      snippet: "Looking at it now.",
      from: { address: "doug@theonefor.ai", name: "Doug" },
      to: ["chair@board.example"],
      body: "Looking at it now.",
      bodyFormat: "text",
      isRead: true,
      mailboxId: "mb-sent",
      receivedAt: at(20),
      sentAt: at(20),
    }),
    message({
      id: "msg-proton",
      threadKey: "thr-proton",
      accountId: SECOND_ACCOUNT_ID,
      mailboxId: "mb-proton-inbox",
      subject: "Personal — insurance renewal",
      snippet: "Your policy renews next month.",
      from: { address: "noreply@insurer.example", name: "Insurer" },
      // Stored under Metadata: the sync never wrote a body, and the policy
      // would refuse one anyway.
      body: null,
      bodyFormat: null,
      receivedAt: at(300),
      sentAt: at(300),
    }),
    // The Google mailbox.
    //
    // This account had a mailbox and no mail, so the fixture had three
    // accounts and threads from two of them — and the unified-inbox test
    // could only ever assert two. That was invisible while rows showed a bare
    // address; it stopped being invisible the moment each row had to carry
    // its account's tint, because a tint that nothing renders is a tint
    // nothing tests.
    message({
      id: "msg-encountive",
      threadKey: "thr-encountive",
      accountId: THIRD_ACCOUNT_ID,
      mailboxId: "mb-encountive-inbox",
      subject: "Encountive — platform review",
      snippet: "The migration slide needs your call before Thursday.",
      from: { address: "maya@encountive.com", name: "Maya Okafor" },
      to: ["doug@encountive.com"],
      // A body, because this account caches in full. Sitting next to the
      // Proton thread above, which has none, the pair is what proves the
      // per-account policy is real rather than described.
      body: "The migration slide needs your call before Thursday.",
      bodyFormat: "text",
      senderImportance: "high",
      receivedAt: at(90),
      sentAt: at(90),
    }),
  ];

  const senders: Sender[] = [
    {
      id: "snd-chair",
      address: "chair@board.example",
      displayName: "Priya Raman",
      importance: "critical",
      notes: "Board chair",
      updatedAt: at(60 * 24),
    },
  ];

  const startOfToday = new Date();
  startOfToday.setHours(9, 0, 0, 0);
  const hours = (n: number) =>
    new Date(startOfToday.getTime() + n * 3600_000).toISOString();

  const calendars: Calendar[] = [
    {
      id: "cal-primary",
      accountId: ACCOUNT_ID,
      remoteId: "primary",
      name: "Doug",
      description: null,
      color: "#3f5f4a",
      timeZone: "America/New_York",
      isPrimary: true,
      isVisible: true,
      access: "read_write",
    },
  ];

  const events: CalendarEvent[] = [
    {
      id: "evt-board",
      calendarId: "cal-primary",
      remoteId: "evt-board",
      seriesId: null,
      title: "Board prep",
      location: null,
      description: null,
      startsAt: hours(1),
      endsAt: hours(2),
      allDay: false,
      timeZone: "America/New_York",
      organizer: { address: "chair@board.example", name: "Priya Raman" },
      attendeeCount: 4,
      isExternal: true,
      response: "accepted",
      isCancelled: false,
      meetingUrl: "https://meet.example/board-prep",
    },
    {
      id: "evt-onetoone",
      calendarId: "cal-primary",
      remoteId: "evt-onetoone",
      seriesId: "series-1",
      title: "1:1 with Maya",
      location: "Room 2",
      description: null,
      startsAt: hours(4),
      endsAt: hours(4.5),
      allDay: false,
      timeZone: "America/New_York",
      organizer: { address: "doug@theonefor.ai", name: "Doug" },
      attendeeCount: 2,
      isExternal: false,
      response: "accepted",
      isCancelled: false,
      meetingUrl: null,
    },
    {
      id: "evt-declined",
      calendarId: "cal-primary",
      remoteId: "evt-declined",
      seriesId: null,
      title: "All-hands (declined)",
      location: null,
      description: null,
      startsAt: hours(6),
      endsAt: hours(7),
      allDay: false,
      timeZone: "America/New_York",
      organizer: { address: "hr@theonefor.ai", name: "People team" },
      attendeeCount: 200,
      isExternal: false,
      response: "declined",
      isCancelled: false,
      meetingUrl: null,
    },
  ];

  return { accounts, mailboxes, messages, senders, calendars, events };
}

/**
 * The store lives on `globalThis`, like every other memory repository here.
 *
 * A module-level `let` looked equivalent and is not: in development Next
 * hands server components and route handlers their own module instances, so
 * a seed applied through one was invisible to the other — the demo week
 * wrote its mail into a copy that nothing read. The symbol is what makes it
 * one store rather than several that agree by luck.
 */
const STATE_KEY = Symbol.for("dashboard.memoryMailState");

function stateStore(): { current: State } {
  const globalStore = globalThis as typeof globalThis & {
    [STATE_KEY]?: { current: State };
  };
  globalStore[STATE_KEY] ??= { current: seed() };
  return globalStore[STATE_KEY];
}

/**
 * Adds to the seeded mailbox rather than replacing it.
 *
 * Merging, not overwriting: the built-in fixtures are what the end-to-end
 * suite asserts against, and a demo that swapped them out would quietly move
 * the ground under every mail test. The demo week appends its own threads to
 * the same accounts.
 */
export function seedMemoryMail(extra: Partial<State>): void {
  const current = stateStore().current;
  stateStore().current = {
    accounts: extra.accounts ?? current.accounts,
    mailboxes: extra.mailboxes ?? current.mailboxes,
    // Deduplicated by id: seeding twice must not double the mailbox. The
    // caller is supposed to run once, and "supposed to" is not a guarantee
    // worth betting a duplicate-key warning on.
    messages: byId([...current.messages, ...(extra.messages ?? [])]),
    senders: byId([...current.senders, ...(extra.senders ?? [])]),
    calendars: byId([...current.calendars, ...(extra.calendars ?? [])]),
    events: byId([...current.events, ...(extra.events ?? [])]),
  };
}

/** Last write wins, order preserved. */
function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

export function resetMemoryMail(): void {
  stateStore().current = seed();
}

function accountFor(id: string): MailAccount {
  const account = stateStore().current.accounts.find((a) => a.id === id);
  if (!account) throw new MailAccountNotFoundError(id);
  return account;
}

/**
 * A message as a caller may see it.
 *
 * The body is stripped unless the account's policy allows one — the same rule
 * the database trigger applies on the way in, applied again on the way out so
 * a seeded fixture cannot smuggle one past it.
 */
function visible(message: Message & { threadKey: string }): Message {
  const account = stateStore().current.accounts.find(
    (a) => a.id === message.accountId,
  );
  const allowed =
    account !== undefined &&
    policyAllowsStorage(account.cachingPolicy) &&
    policyAllowsBodies(account.cachingPolicy);

  const rest: Message = { ...message };
  delete (rest as Partial<Message & { threadKey: string }>).threadKey;

  return allowed ? rest : { ...rest, body: null, bodyFormat: null };
}

function summarise(threadKey: string): ThreadSummary | null {
  const inThread = stateStore()
    .current.messages.filter((m) => m.threadKey === threadKey)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  if (inThread.length === 0) return null;

  const latest = inThread[inThread.length - 1];
  const account = accountFor(latest.accountId);

  // Who you would be replying to — the last message from someone who is not
  // you. Showing the thread's latest sender puts *your own name* on a thread
  // you replied to, which on the attention card reads as "you are waiting on
  // yourself". Every mail client shows the correspondent; so does this.
  const correspondent =
    [...inThread]
      .reverse()
      .find(
        (m) =>
          m.from.address.toLowerCase() !== account.emailAddress.toLowerCase(),
      ) ?? latest;

  // The importance that matters is the highest anyone in the thread carries:
  // a critical sender's message stays critical after you reply to it.
  const importance = inThread.reduce<SenderImportance>(
    (best, m) =>
      SENDER_IMPORTANCE_RANK[m.senderImportance] < SENDER_IMPORTANCE_RANK[best]
        ? m.senderImportance
        : best,
    "normal",
  );

  return {
    id: threadKey,
    accountId: latest.accountId,
    accountAddress: account.emailAddress,
    provider: account.provider,
    subject: inThread[0].subject,
    from: correspondent.from,
    snippet: correspondent.snippet,
    lastMessageAt: latest.receivedAt,
    messageCount: inThread.length,
    unreadCount: inThread.filter((m) => !m.isRead).length,
    hasAttachments: inThread.some((m) => m.hasAttachments),
    senderImportance: importance,
  };
}

export const memoryMailRepository: MailRepository = {
  async listAccounts() {
    return stateStore().current.accounts.map((a) => ({ ...a }));
  },

  async getAccount(id) {
    const account = stateStore().current.accounts.find((a) => a.id === id);
    return account ? { ...account } : null;
  },

  async updateAccount(id, patch) {
    const account = accountFor(id);
    Object.assign(account, {
      cachingPolicy: patch.cachingPolicy ?? account.cachingPolicy,
      syncMailEnabled: patch.syncMailEnabled ?? account.syncMailEnabled,
      syncCalendarEnabled:
        patch.syncCalendarEnabled ?? account.syncCalendarEnabled,
      retentionMonths: patch.retentionMonths ?? account.retentionMonths,
    });

    // Dropping to a policy that forbids storage discards what was stored,
    // immediately. Leaving bodies behind under Metadata would make the setting
    // a label rather than a rule.
    if (!policyAllowsBodies(account.cachingPolicy)) {
      for (const message of stateStore().current.messages) {
        if (message.accountId === id) {
          message.body = null;
          message.bodyFormat = null;
        }
      }
    }
    if (!policyAllowsStorage(account.cachingPolicy)) {
      stateStore().current.messages = stateStore().current.messages.filter(
        (m) => m.accountId !== id,
      );
    }

    return { ...account };
  },

  async disconnectAccount(id) {
    accountFor(id);
    stateStore().current.accounts = stateStore().current.accounts.filter(
      (a) => a.id !== id,
    );
    stateStore().current.messages = stateStore().current.messages.filter(
      (m) => m.accountId !== id,
    );
    stateStore().current.mailboxes = stateStore().current.mailboxes.filter(
      (m) => m.accountId !== id,
    );
    const calendarIds = stateStore()
      .current.calendars.filter((c) => c.accountId === id)
      .map((c) => c.id);
    stateStore().current.calendars = stateStore().current.calendars.filter(
      (c) => c.accountId !== id,
    );
    stateStore().current.events = stateStore().current.events.filter(
      (e) => !calendarIds.includes(e.calendarId),
    );
  },

  async listMailboxes(accountId) {
    return stateStore()
      .current.mailboxes.filter((m) => m.accountId === accountId)
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ ...m }));
  },

  async listThreads(query: ThreadQuery) {
    const keys = [
      ...new Set(stateStore().current.messages.map((m) => m.threadKey)),
    ];
    const needle = query.q?.trim().toLowerCase();

    return keys
      .map(summarise)
      .filter((t): t is ThreadSummary => t !== null)
      .filter((t) => !query.accountId || t.accountId === query.accountId)
      .filter((t) => !query.unreadOnly || t.unreadCount > 0)
      .filter((t) => {
        if (!query.mailboxKind) return true;
        const kinds = stateStore()
          .current.messages.filter((m) => m.threadKey === t.id)
          .map(
            (m) =>
              stateStore().current.mailboxes.find(
                (box) => box.id === m.mailboxId,
              )?.kind ?? "other",
          );
        return kinds.includes(query.mailboxKind);
      })
      .filter((t) => {
        if (!query.minImportance) return true;
        return (
          SENDER_IMPORTANCE_RANK[t.senderImportance] <=
          SENDER_IMPORTANCE_RANK[query.minImportance]
        );
      })
      .filter((t) => {
        if (!needle) return true;
        return (
          (t.subject ?? "").toLowerCase().includes(needle) ||
          (t.snippet ?? "").toLowerCase().includes(needle) ||
          t.from.address.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) =>
        (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
      )
      .slice(0, query.limit ?? 50);
  },

  async getThread(id) {
    const thread = summarise(id);
    if (!thread) return null;

    const messages = stateStore()
      .current.messages.filter((m) => m.threadKey === id)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .map(visible);

    return { thread, messages };
  },

  async getMessage(id) {
    const message = stateStore().current.messages.find((m) => m.id === id);
    if (!message) return null;

    const account = accountFor(message.accountId);
    if (!policyAllowsStorage(account.cachingPolicy)) {
      throw new PolicyForbidsError(account.cachingPolicy);
    }

    return visible(message);
  },

  async markRead(messageIds, read) {
    for (const message of stateStore().current.messages) {
      if (messageIds.includes(message.id)) message.isRead = read;
    }
  },

  async setFlag(messageId, flagged) {
    const message = stateStore().current.messages.find(
      (m) => m.id === messageId,
    );
    if (!message) throw new MessageNotFoundError(messageId);
    message.isFlagged = flagged;
    return visible(message);
  },

  async listSenders() {
    return stateStore().current.senders.map((s) => ({ ...s }));
  },

  async rateSender(address, importance, notes) {
    const normalized = address.trim().toLowerCase();
    let sender = stateStore().current.senders.find(
      (s) => s.address === normalized,
    );

    if (!sender) {
      sender = {
        id: randomUUID(),
        address: normalized,
        displayName: null,
        importance,
        notes: notes ?? null,
        updatedAt: new Date().toISOString(),
      };
      stateStore().current.senders.push(sender);
    } else {
      sender.importance = importance;
      if (notes !== undefined) sender.notes = notes;
      sender.updatedAt = new Date().toISOString();
    }

    // A rating applies to mail already received, not only to what arrives
    // next — otherwise marking someone critical does nothing until they write
    // again, which is the opposite of what the owner meant.
    for (const message of stateStore().current.messages) {
      if (message.from.address.toLowerCase() === normalized) {
        message.senderImportance = importance;
      }
    }

    return { ...sender };
  },

  async listCalendars() {
    return stateStore().current.calendars.map((c) => ({ ...c }));
  },

  async listEvents(query: EventQuery) {
    const visibleCalendars = new Set(
      stateStore()
        .current.calendars.filter((c) => c.isVisible)
        .map((c) => c.id),
    );

    return stateStore()
      .current.events.filter((e) => visibleCalendars.has(e.calendarId))
      .filter((e) => !query.calendarId || e.calendarId === query.calendarId)
      .filter((e) => e.endsAt >= query.from && e.startsAt <= query.to)
      .filter((e) =>
        (query.hideDeclined ?? true) ? e.response !== "declined" : true,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((e) => ({ ...e }));
  },

  async setCalendarVisible(id, visible_) {
    const calendar = stateStore().current.calendars.find((c) => c.id === id);
    if (!calendar) throw new Error(`Calendar ${id} was not found`);
    calendar.isVisible = visible_;
    return { ...calendar };
  },
};
