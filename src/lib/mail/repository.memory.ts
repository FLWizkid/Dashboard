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
 * Fixture ids are UUIDs, not slugs.
 *
 * The API schemas validate ids as UUIDs (`markReadSchema.messageIds`,
 * `threadQuerySchema.accountId`, `eventQuerySchema.calendarId`), and this
 * fake must satisfy the same contract the real store does. With slug ids,
 * every mark-as-read call in memory mode failed schema validation with a 400
 * — while the E2E suite stayed green, because it asserted on a row's absence
 * rather than on the call succeeding.
 *
 * The block prefix says what kind of thing each id is in a trace; the tail
 * byte says which one. Remote ids stay provider-shaped ("INBOX", "primary")
 * because that is what the real providers send.
 */
const ACCOUNT_ID = "acc00000-0000-4000-8000-000000000001"; // Google
const SECOND_ACCOUNT_ID = "acc00000-0000-4000-8000-000000000002"; // Proton
const MB_INBOX = "ba000000-0000-4000-8000-000000000001";
const MB_SENT = "ba000000-0000-4000-8000-000000000002";
const MB_PROTON_INBOX = "ba000000-0000-4000-8000-000000000003";
const MSG_BOARD = "ee000000-0000-4000-8000-000000000001";
const MSG_VENDOR = "ee000000-0000-4000-8000-000000000002";
const MSG_REPLY = "ee000000-0000-4000-8000-000000000003";
const MSG_PROTON = "ee000000-0000-4000-8000-000000000004";
const THR_BOARD = "dd000000-0000-4000-8000-000000000001";
const THR_VENDOR = "dd000000-0000-4000-8000-000000000002";
const THR_PROTON = "dd000000-0000-4000-8000-000000000003";
const CAL_PRIMARY = "ca000000-0000-4000-8000-000000000001";
const EVT_BOARD = "ef000000-0000-4000-8000-000000000001";
const EVT_ONETOONE = "ef000000-0000-4000-8000-000000000002";
const EVT_DECLINED = "ef000000-0000-4000-8000-000000000003";

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
      provider: "gmail",
      remoteId: "google-1",
      emailAddress: "doug@theonefor.ai",
      displayName: "Doug",
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
      id: SECOND_ACCOUNT_ID,
      provider: "proton_bridge",
      remoteId: "proton-1",
      emailAddress: "doug@proton.me",
      displayName: null,
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
      id: MB_INBOX,
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
      id: MB_SENT,
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
      id: MB_PROTON_INBOX,
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
    mailboxId: MB_INBOX,
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
      id: MSG_BOARD,
      threadKey: THR_BOARD,
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
      id: MSG_VENDOR,
      threadKey: THR_VENDOR,
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
      id: MSG_REPLY,
      threadKey: THR_BOARD,
      subject: "Re: Board pack for Thursday",
      snippet: "Looking at it now.",
      from: { address: "doug@theonefor.ai", name: "Doug" },
      to: ["chair@board.example"],
      body: "Looking at it now.",
      bodyFormat: "text",
      isRead: true,
      mailboxId: MB_SENT,
      receivedAt: at(20),
      sentAt: at(20),
    }),
    message({
      id: MSG_PROTON,
      threadKey: THR_PROTON,
      accountId: SECOND_ACCOUNT_ID,
      mailboxId: MB_PROTON_INBOX,
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
      id: CAL_PRIMARY,
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
      id: EVT_BOARD,
      calendarId: CAL_PRIMARY,
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
      id: EVT_ONETOONE,
      calendarId: CAL_PRIMARY,
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
      id: EVT_DECLINED,
      calendarId: CAL_PRIMARY,
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

let state = seed();

export function resetMemoryMail(): void {
  state = seed();
}

function accountFor(id: string): MailAccount {
  const account = state.accounts.find((a) => a.id === id);
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
  const account = state.accounts.find((a) => a.id === message.accountId);
  const allowed =
    account !== undefined &&
    policyAllowsStorage(account.cachingPolicy) &&
    policyAllowsBodies(account.cachingPolicy);

  const rest: Message = { ...message };
  delete (rest as Partial<Message & { threadKey: string }>).threadKey;

  return allowed ? rest : { ...rest, body: null, bodyFormat: null };
}

function summarise(threadKey: string): ThreadSummary | null {
  const inThread = state.messages
    .filter((m) => m.threadKey === threadKey)
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
    return state.accounts.map((a) => ({ ...a }));
  },

  async getAccount(id) {
    const account = state.accounts.find((a) => a.id === id);
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
      for (const message of state.messages) {
        if (message.accountId === id) {
          message.body = null;
          message.bodyFormat = null;
        }
      }
    }
    if (!policyAllowsStorage(account.cachingPolicy)) {
      state.messages = state.messages.filter((m) => m.accountId !== id);
    }

    return { ...account };
  },

  async disconnectAccount(id) {
    accountFor(id);
    state.accounts = state.accounts.filter((a) => a.id !== id);
    state.messages = state.messages.filter((m) => m.accountId !== id);
    state.mailboxes = state.mailboxes.filter((m) => m.accountId !== id);
    const calendarIds = state.calendars
      .filter((c) => c.accountId === id)
      .map((c) => c.id);
    state.calendars = state.calendars.filter((c) => c.accountId !== id);
    state.events = state.events.filter(
      (e) => !calendarIds.includes(e.calendarId),
    );
  },

  async listMailboxes(accountId) {
    return state.mailboxes
      .filter((m) => m.accountId === accountId)
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ ...m }));
  },

  async listThreads(query: ThreadQuery) {
    const keys = [...new Set(state.messages.map((m) => m.threadKey))];
    const needle = query.q?.trim().toLowerCase();

    return keys
      .map(summarise)
      .filter((t): t is ThreadSummary => t !== null)
      .filter((t) => !query.accountId || t.accountId === query.accountId)
      .filter((t) => !query.unreadOnly || t.unreadCount > 0)
      .filter((t) => {
        if (!query.mailboxKind) return true;
        const kinds = state.messages
          .filter((m) => m.threadKey === t.id)
          .map(
            (m) =>
              state.mailboxes.find((box) => box.id === m.mailboxId)?.kind ??
              "other",
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

    const messages = state.messages
      .filter((m) => m.threadKey === id)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .map(visible);

    return { thread, messages };
  },

  async getMessage(id) {
    const message = state.messages.find((m) => m.id === id);
    if (!message) return null;

    const account = accountFor(message.accountId);
    if (!policyAllowsStorage(account.cachingPolicy)) {
      throw new PolicyForbidsError(account.cachingPolicy);
    }

    return visible(message);
  },

  async markRead(messageIds, read) {
    for (const message of state.messages) {
      if (messageIds.includes(message.id)) message.isRead = read;
    }
  },

  async setFlag(messageId, flagged) {
    const message = state.messages.find((m) => m.id === messageId);
    if (!message) throw new MessageNotFoundError(messageId);
    message.isFlagged = flagged;
    return visible(message);
  },

  async listSenders() {
    return state.senders.map((s) => ({ ...s }));
  },

  async rateSender(address, importance, notes) {
    const normalized = address.trim().toLowerCase();
    let sender = state.senders.find((s) => s.address === normalized);

    if (!sender) {
      sender = {
        id: randomUUID(),
        address: normalized,
        displayName: null,
        importance,
        notes: notes ?? null,
        updatedAt: new Date().toISOString(),
      };
      state.senders.push(sender);
    } else {
      sender.importance = importance;
      if (notes !== undefined) sender.notes = notes;
      sender.updatedAt = new Date().toISOString();
    }

    // A rating applies to mail already received, not only to what arrives
    // next — otherwise marking someone critical does nothing until they write
    // again, which is the opposite of what the owner meant.
    for (const message of state.messages) {
      if (message.from.address.toLowerCase() === normalized) {
        message.senderImportance = importance;
      }
    }

    return { ...sender };
  },

  async listCalendars() {
    return state.calendars.map((c) => ({ ...c }));
  },

  async listEvents(query: EventQuery) {
    const visibleCalendars = new Set(
      state.calendars.filter((c) => c.isVisible).map((c) => c.id),
    );

    return state.events
      .filter((e) => visibleCalendars.has(e.calendarId))
      .filter((e) => !query.calendarId || e.calendarId === query.calendarId)
      .filter((e) => e.endsAt >= query.from && e.startsAt <= query.to)
      .filter((e) =>
        (query.hideDeclined ?? true) ? e.response !== "declined" : true,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((e) => ({ ...e }));
  },

  async setCalendarVisible(id, visible_) {
    const calendar = state.calendars.find((c) => c.id === id);
    if (!calendar) throw new Error(`Calendar ${id} was not found`);
    calendar.isVisible = visible_;
    return { ...calendar };
  },
};
