/**
 * Delivering a digest.
 *
 * Two channels, and one rule about the order they run in.
 *
 * ── The in-app inbox is written first, always ────────────────────────────
 * It is local, it cannot fail for a reason outside the box, and it is the
 * copy the owner can always reach. Email goes out afterwards, and **a failed
 * send never loses the digest** — the inbox message is already there, marked
 * with what went wrong.
 *
 * The reverse order is the tempting one (send, then record what was sent) and
 * it means an SMTP outage on Monday morning produces no brief at all, with no
 * trace that one was due.
 *
 * ── Why email is behind an adapter ───────────────────────────────────────
 * The box has no mail server. Whatever the owner points this at — a relay on
 * their tailnet, an SMTP account, nothing at all — is their choice, and the
 * digest code should not care. The stub adapter is what the integration tests
 * run against, and it is also a perfectly reasonable production setting for
 * someone who only wants the in-app inbox.
 */

import type { Digest } from "./digest";

export const DELIVERY_CHANNELS = ["inbox", "email"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  ok: boolean;
  /** Provider's id, when it gave one. */
  messageId?: string;
  error?: string;
}

/** The seam every outbound email goes through. */
export interface EmailChannel {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
}

/**
 * The default: record it and report success without sending anything.
 *
 * Not a failure mode — it is what runs when no relay is configured, and it
 * keeps the in-app inbox working on a box with no outbound mail at all. Sent
 * messages are kept in memory so tests can assert on them.
 */
export function createStubEmailChannel(): EmailChannel & {
  sent: EmailMessage[];
} {
  const sent: EmailMessage[] = [];

  return {
    name: "stub",
    sent,
    async send(message) {
      sent.push(message);
      return { ok: true, messageId: `stub-${sent.length}` };
    },
  };
}

/**
 * The narrow slice of an SMTP transport this module needs.
 *
 * Declared rather than imported, and injectable, for the same reason the
 * Proton adapter does it: the transport is the seam where tests substitute a
 * fake, and depending on a library's types here would make that harder for no
 * benefit. `nodemailer` is already a direct dependency (the Proton bridge
 * uses it), so the default below costs nothing extra.
 */
export interface DigestTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ messageId?: string }>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure?: boolean;
  /** Injected by tests; the default builds a real nodemailer transport. */
  createTransport?: () => Promise<DigestTransport>;
}

/**
 * SMTP, via whatever relay the owner configured.
 *
 * The import is dynamic and inside `send`, so a box with no relay configured
 * never loads it at all.
 */
export function createSmtpEmailChannel(config: SmtpConfig): EmailChannel {
  return {
    name: "smtp",
    async send(message) {
      try {
        const transport = config.createTransport
          ? await config.createTransport()
          : await defaultTransport(config);

        const info = await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });

        return { ok: true, messageId: info.messageId };
      } catch (error) {
        // A failed send is reported, never thrown: the in-app copy is already
        // written, and a cron job that crashes on an SMTP outage is worse
        // than one that records the failure and carries on.
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Send failed",
        };
      }
    },
  };
}

async function defaultTransport(config: SmtpConfig): Promise<DigestTransport> {
  const nodemailer = (await import("nodemailer")) as unknown as {
    createTransport: (options: unknown) => DigestTransport;
  };

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
}

/**
 * Reads the channel out of the environment.
 *
 * Absent configuration means the stub, not an error. Someone running this on
 * their own box with no relay should get their morning brief in the app, not
 * a crashed cron job.
 */
export function emailChannelFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmailChannel {
  const host = env.DIGEST_SMTP_HOST;
  const from = env.DIGEST_FROM;

  if (!host || !from) return createStubEmailChannel();

  return createSmtpEmailChannel({
    host,
    port: Number(env.DIGEST_SMTP_PORT ?? 587),
    user: env.DIGEST_SMTP_USER,
    pass: env.DIGEST_SMTP_PASS,
    from,
    secure: env.DIGEST_SMTP_SECURE === "true",
  });
}

/* ── The delivery itself ──────────────────────────────────────────────── */

export interface InboxWrite {
  kind: Digest["kind"];
  subject: string;
  preview: string;
  body: string;
  html: string;
  generatedAt: string;
}

export interface DeliveryStore {
  /** Writes the in-app copy and returns its id. */
  writeInbox(message: InboxWrite): Promise<string>;
  /** Records what happened, for the runbook and for not double-sending. */
  recordRun(run: {
    kind: Digest["kind"];
    inboxMessageId: string;
    emailAttempted: boolean;
    emailOk: boolean;
    emailError: string | null;
    channel: string;
  }): Promise<void>;
}

export interface DeliverOptions {
  digest: Digest;
  store: DeliveryStore;
  email?: EmailChannel;
  /** Absent means "inbox only" — a perfectly valid configuration. */
  to?: string | null;
}

export interface DeliveryOutcome {
  inboxMessageId: string;
  emailAttempted: boolean;
  emailOk: boolean;
  emailError: string | null;
}

export async function deliverDigest(
  options: DeliverOptions,
): Promise<DeliveryOutcome> {
  const { digest, store } = options;

  // First, and unconditionally. Everything after this can fail without the
  // digest being lost.
  const inboxMessageId = await store.writeInbox({
    kind: digest.kind,
    subject: digest.subject,
    preview: digest.preview,
    body: digest.text,
    html: digest.html,
    generatedAt: digest.generatedAt,
  });

  const channel = options.email;
  const to = options.to?.trim();

  if (!channel || !to) {
    await store.recordRun({
      kind: digest.kind,
      inboxMessageId,
      emailAttempted: false,
      emailOk: false,
      emailError: null,
      channel: channel?.name ?? "none",
    });

    return {
      inboxMessageId,
      emailAttempted: false,
      emailOk: false,
      emailError: null,
    };
  }

  const result = await channel.send({
    to,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });

  await store.recordRun({
    kind: digest.kind,
    inboxMessageId,
    emailAttempted: true,
    emailOk: result.ok,
    emailError: result.error ?? null,
    channel: channel.name,
  });

  return {
    inboxMessageId,
    emailAttempted: true,
    emailOk: result.ok,
    emailError: result.error ?? null,
  };
}
