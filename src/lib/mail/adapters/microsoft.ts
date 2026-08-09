/**
 * Microsoft Graph adapter — Outlook mail and calendar.
 *
 * Wired, tested and ready; it simply cannot be *connected* until an Azure
 * application is registered, because there is nothing to obtain a token from.
 * That is a configuration state, not an unfinished feature: see
 * `providerConfigured()` in ../oauth.ts. When the registration exists, adding
 * two environment variables turns this on.
 *
 * ── Differences from Gmail that shape the code ───────────────────────────
 * • Graph has real folders, so `parentFolderId` maps straight onto a mailbox
 *   — no label-picking heuristics.
 * • A message arrives with its body already attached, so there is no
 *   second round trip. `$select` is therefore what enforces the Metadata
 *   caching policy: leave `body` out of the projection and Graph does not
 *   send it.
 * • Sending returns 202 Accepted with an empty body — the sent message's id
 *   is simply not available, which the return type has to be honest about.
 * • Corporate tenants commonly refuse the app until an administrator grants
 *   consent; that is surfaced as its own error kind rather than as an auth
 *   failure, so the owner is told to request consent instead of being sent
 *   round the sign-in loop.
 */

import type { Mailbox, MailboxKind } from "../types";
import { HttpClient } from "./http";
import {
  NO_CAPABILITIES,
  type AccountIdentity,
  type FetchedCalendar,
  type FetchedEvent,
  type FetchedMessage,
  type ListMessagesOptions,
  type MailAdapter,
  type MessagePage,
  type OutgoingMessage,
  type ProviderCapabilities,
  type SearchOptions,
  type SentMessage,
} from "./types";
import { summarizeThreads } from "./google";

export const MICROSOFT_CAPABILITIES: ProviderCapabilities = {
  ...NO_CAPABILITIES,
  readMail: true,
  sendMail: true,
  serverSearch: true,
  incrementalSync: true,
  writeFlags: true,
  readCalendar: true,
  // Deliberately off for now: creating events needs Calendars.ReadWrite, a
  // scope worth requesting only once the product actually writes events.
  writeCalendar: false,
  push: true,
  limitations: [
    "Requires an Azure app registration before it can be connected; until then the provider is listed but not offered.",
    "Corporate tenants frequently require administrator consent before the app may read mail. The connect flow surfaces this as its own state.",
    "Sending returns no identifier for the sent message, so a sent mail appears once the Sent folder next syncs rather than immediately.",
    "Creating or editing calendar events is not enabled; the calendar is read-only.",
  ],
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * The projection used for list views.
 *
 * `body` is absent on purpose — this is where the Metadata caching policy is
 * enforced on the wire for Graph.
 */
const METADATA_SELECT = [
  "id",
  "conversationId",
  "parentFolderId",
  "internetMessageId",
  "subject",
  "bodyPreview",
  "from",
  "toRecipients",
  "ccRecipients",
  "sentDateTime",
  "receivedDateTime",
  "isRead",
  "flag",
  "isDraft",
  "hasAttachments",
].join(",");

const FULL_SELECT = `${METADATA_SELECT},body`;

/* ── Wire shapes ──────────────────────────────────────────────────────── */

interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  parentFolderId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  sentDateTime?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  flag?: { flagStatus?: string };
}

interface GraphFolder {
  id: string;
  displayName?: string;
  totalItemCount?: number;
  unreadItemCount?: number;
  wellKnownName?: string;
}

interface GraphCalendar {
  id: string;
  name?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  owner?: { address?: string };
}

interface GraphEvent {
  id: string;
  seriesMasterId?: string;
  subject?: string;
  location?: { displayName?: string };
  bodyPreview?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  onlineMeeting?: { joinUrl?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  organizer?: GraphRecipient;
  attendees?: {
    emailAddress?: { address?: string };
    status?: { response?: string };
  }[];
  responseStatus?: { response?: string };
}

interface GraphList<T> {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

/* ── Normalization ────────────────────────────────────────────────────── */

function toAddress(recipient: GraphRecipient | undefined) {
  const address = recipient?.emailAddress?.address;
  if (!address) return null;
  return {
    address: address.toLowerCase(),
    name: recipient?.emailAddress?.name ?? null,
  };
}

export function folderKind(folder: GraphFolder): MailboxKind {
  switch (folder.wellKnownName) {
    case "inbox":
      return "inbox";
    case "sentitems":
      return "sent";
    case "drafts":
      return "drafts";
    case "archive":
      return "archive";
    case "junkemail":
      return "spam";
    case "deleteditems":
      return "trash";
    default:
      return "custom";
  }
}

export function normalizeGraphMessage(message: GraphMessage): FetchedMessage {
  const from = toAddress(message.from) ?? {
    address: "unknown@invalid",
    name: null,
  };

  // Graph's contentType is "text" or "html"; anything else is not a body we
  // know how to render, so it is treated as absent rather than guessed at.
  const rawFormat = message.body?.contentType?.toLowerCase();
  const format =
    rawFormat === "html" ? "html" : rawFormat === "text" ? "text" : null;
  const content = message.body?.content ?? null;

  return {
    remoteId: message.id,
    threadRemoteId: message.conversationId ?? null,
    mailboxRemoteId: message.parentFolderId ?? null,
    messageIdHeader: message.internetMessageId ?? null,

    subject: message.subject ?? null,
    snippet: message.bodyPreview ?? null,

    from,
    to: (message.toRecipients ?? [])
      .map(toAddress)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    cc: (message.ccRecipients ?? [])
      .map(toAddress)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),

    sentAt: message.sentDateTime ?? null,
    receivedAt: message.receivedDateTime ?? new Date().toISOString(),

    isRead: message.isRead ?? false,
    isFlagged: message.flag?.flagStatus === "flagged",
    isDraft: message.isDraft ?? false,
    hasAttachments: message.hasAttachments ?? false,

    body: content && format ? content : null,
    bodyFormat: content && format ? format : null,
  };
}

export function normalizeGraphEvent(
  event: GraphEvent,
  calendarRemoteId: string,
  internalDomains: string[],
): FetchedEvent {
  const attendees = (event.attendees ?? [])
    .map((attendee) => attendee.emailAddress?.address?.toLowerCase())
    .filter((address): address is string => Boolean(address));

  const isExternal =
    internalDomains.length > 0 &&
    attendees.some((address) => {
      const domain = address.split("@")[1] ?? "";
      return domain !== "" && !internalDomains.includes(domain);
    });

  return {
    remoteId: event.id,
    calendarRemoteId,
    seriesId: event.seriesMasterId ?? null,
    title: event.subject ?? "(no title)",
    location: event.location?.displayName ?? null,
    description: event.bodyPreview ?? null,
    // Graph returns a local wall-clock string plus a separate zone. Treating
    // it as UTC is the classic Outlook bug; the zone travels alongside it and
    // the storage layer resolves the two together.
    startsAt: event.start?.dateTime ?? new Date().toISOString(),
    endsAt:
      event.end?.dateTime ?? event.start?.dateTime ?? new Date().toISOString(),
    allDay: event.isAllDay ?? false,
    timeZone: event.start?.timeZone ?? null,
    organizer: toAddress(event.organizer),
    attendeeAddresses: attendees,
    isExternal,
    response: mapGraphResponse(event.responseStatus?.response),
    isCancelled: event.isCancelled ?? false,
    meetingUrl: event.onlineMeeting?.joinUrl ?? null,
  };
}

function mapGraphResponse(
  response: string | undefined,
): FetchedEvent["response"] {
  switch (response) {
    case "accepted":
      return "accepted";
    case "tentativelyAccepted":
      return "tentative";
    case "declined":
      return "declined";
    case "notResponded":
      return "needs_action";
    case "organizer":
      return "organizer";
    default:
      return "unknown";
  }
}

/* ── The adapter ──────────────────────────────────────────────────────── */

export interface MicrosoftAdapterOptions {
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryBaseMs?: number;
  internalDomains?: string[];
}

export function createMicrosoftAdapter(
  options: MicrosoftAdapterOptions,
): MailAdapter {
  const graph = new HttpClient({
    provider: "microsoft",
    baseUrl: GRAPH_BASE,
    getAccessToken: options.getAccessToken,
    fetchImpl: options.fetchImpl,
    maxAttempts: options.maxAttempts,
    retryBaseMs: options.retryBaseMs,
  });

  const internalDomains = (options.internalDomains ?? []).map((domain) =>
    domain.toLowerCase().replace(/^@/, ""),
  );

  return {
    provider: "microsoft",
    capabilities: MICROSOFT_CAPABILITIES,

    async identify(): Promise<AccountIdentity> {
      const me = await graph.request<{
        id: string;
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
      }>("/me", {
        query: { $select: "id,mail,userPrincipalName,displayName" },
      });

      // `mail` is empty on plenty of tenants; the principal name is the
      // reliable fallback.
      const address = me.mail ?? me.userPrincipalName ?? me.id;

      return {
        remoteId: me.id,
        emailAddress: address,
        displayName: me.displayName ?? null,
      };
    },

    async listMailboxes(): Promise<Mailbox[]> {
      const response = await graph.request<GraphList<GraphFolder>>(
        "/me/mailFolders",
        { query: { $top: 100 } },
      );

      return (response.value ?? []).map((folder, index) => ({
        id: "",
        accountId: "",
        remoteId: folder.id,
        name: folder.displayName ?? folder.id,
        kind: folderKind(folder),
        unreadCount: folder.unreadItemCount ?? 0,
        totalCount: folder.totalItemCount ?? 0,
        syncEnabled: !["junkemail", "deleteditems"].includes(
          folder.wellKnownName ?? "",
        ),
        position: index,
      }));
    },

    async listMessages(
      listOptions: ListMessagesOptions = {},
    ): Promise<MessagePage> {
      const includeBodies = listOptions.includeBodies ?? false;
      const limit = Math.min(listOptions.limit ?? 50, 200);

      // A delta link is a complete URL; hand it straight back.
      const path = listOptions.cursor
        ? listOptions.cursor
        : listOptions.mailboxRemoteId
          ? `/me/mailFolders/${encodeURIComponent(listOptions.mailboxRemoteId)}/messages`
          : "/me/messages";

      const query = listOptions.cursor
        ? undefined
        : {
            $select: includeBodies ? FULL_SELECT : METADATA_SELECT,
            $top: limit,
            $orderby: "receivedDateTime desc",
            ...(listOptions.since
              ? {
                  $filter: `receivedDateTime ge ${listOptions.since.toISOString()}`,
                }
              : {}),
          };

      const response = await graph.request<GraphList<GraphMessage>>(path, {
        query,
      });

      const messages = (response.value ?? [])
        .map(normalizeGraphMessage)
        .map((message) =>
          includeBodies
            ? message
            : { ...message, body: null, bodyFormat: null },
        );

      return {
        messages,
        threads: summarizeThreads(messages),
        cursor:
          response["@odata.nextLink"] ?? response["@odata.deltaLink"] ?? null,
      };
    },

    async getMessage(remoteId, getOptions = {}) {
      const includeBody = getOptions.includeBody ?? true;

      const message = await graph.request<GraphMessage>(
        `/me/messages/${encodeURIComponent(remoteId)}`,
        { query: { $select: includeBody ? FULL_SELECT : METADATA_SELECT } },
      );

      const normalized = normalizeGraphMessage(message);
      return includeBody
        ? normalized
        : { ...normalized, body: null, bodyFormat: null };
    },

    async searchMessages(searchOptions: SearchOptions) {
      const response = await graph.request<GraphList<GraphMessage>>(
        "/me/messages",
        {
          query: {
            // Graph's $search wants the term quoted, and refuses $orderby
            // alongside it.
            $search: `"${searchOptions.query.replace(/"/g, "")}"`,
            $select: searchOptions.includeBodies
              ? FULL_SELECT
              : METADATA_SELECT,
            $top: Math.min(searchOptions.limit ?? 25, 100),
          },
        },
      );

      return (response.value ?? []).map(normalizeGraphMessage);
    },

    async sendMessage(message: OutgoingMessage): Promise<SentMessage> {
      await graph.request("/me/sendMail", {
        method: "POST",
        body: {
          message: {
            subject: message.subject,
            body: {
              contentType: message.bodyFormat === "html" ? "HTML" : "Text",
              content: message.body,
            },
            toRecipients: message.to.map((entry) => ({
              emailAddress: {
                address: entry.address,
                name: entry.name ?? undefined,
              },
            })),
            ccRecipients: (message.cc ?? []).map((entry) => ({
              emailAddress: { address: entry.address },
            })),
            bccRecipients: (message.bcc ?? []).map((entry) => ({
              emailAddress: { address: entry.address },
            })),
          },
          saveToSentItems: true,
        },
      });

      // 202 Accepted, no body. Being honest about that is better than
      // inventing an identifier the caller would then try to fetch.
      return {
        remoteId: null,
        threadRemoteId: message.threadRemoteId ?? null,
        messageIdHeader: null,
      };
    },

    async setRead(remoteId: string, read: boolean) {
      await graph.request(`/me/messages/${encodeURIComponent(remoteId)}`, {
        method: "PATCH",
        body: { isRead: read },
      });
    },

    async setFlagged(remoteId: string, flagged: boolean) {
      await graph.request(`/me/messages/${encodeURIComponent(remoteId)}`, {
        method: "PATCH",
        body: { flag: { flagStatus: flagged ? "flagged" : "notFlagged" } },
      });
    },

    async listCalendars(): Promise<FetchedCalendar[]> {
      const response =
        await graph.request<GraphList<GraphCalendar>>("/me/calendars");

      return (response.value ?? []).map((entry) => ({
        remoteId: entry.id,
        name: entry.name ?? entry.id,
        description: null,
        timeZone: null,
        isPrimary: entry.isDefaultCalendar === true,
        // Read-only regardless of `canEdit`: the app does not request
        // Calendars.ReadWrite, so claiming otherwise would be a lie the UI
        // would act on.
        access: "read",
      }));
    },

    async listEvents({ calendarRemoteId, from, to, cursor }) {
      const path = cursor
        ? cursor
        : `/me/calendars/${encodeURIComponent(calendarRemoteId)}/calendarView`;

      const response = await graph.request<GraphList<GraphEvent>>(path, {
        query: cursor
          ? undefined
          : {
              // calendarView, not /events: it expands recurrences into the
              // occurrences that actually fall in the window.
              startDateTime: from.toISOString(),
              endDateTime: to.toISOString(),
              $top: 250,
              $orderby: "start/dateTime",
            },
      });

      return {
        events: (response.value ?? []).map((event) =>
          normalizeGraphEvent(event, calendarRemoteId, internalDomains),
        ),
        cursor: response["@odata.nextLink"] ?? null,
      };
    },
  };
}
