"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/**
 * The Proton connect form.
 *
 * Proton is the one account that cannot be connected by pressing a button and
 * approving a consent screen: Bridge runs on this machine and what it wants
 * is a hostname, two ports, a username and the per-application password it
 * generated.
 *
 * ── Why the fields are named the way they are ────────────────────────────
 * Every label here is the word **Bridge itself uses** in its Mailbox details
 * panel — Hostname, Port, Username, Password, Security — and the layout is
 * Bridge's own two columns, IMAP beside SMTP. The point is that the form
 * needs no instructions: put the two windows side by side and copy each field
 * into the box with the same name. A form that invents its own vocabulary
 * ("Server address", "Mail port") makes the owner translate, and translation
 * is where a wrong port comes from.
 *
 * Bridge repeats the hostname, username and password identically in both
 * columns and varies only the port, so those three are asked once, under a
 * heading that says so.
 */

/**
 * Bridge's documented defaults.
 *
 * Pre-filled because they are right for most installations — but Bridge
 * silently picks the next free port when something else holds these, so a
 * real installation can be on 1144/1026 or higher. That is exactly the
 * mistake this form has to make hard, which is why the ports sit in their own
 * bordered block with "must match Bridge exactly" attached to them rather
 * than being quietly correct-looking.
 */
const BRIDGE_DEFAULTS = {
  host: "127.0.0.1",
  imapPort: 1143,
  smtpPort: 1025,
};

export function ConnectProton({ onConnected }: { onConnected?: () => void }) {
  const [emailAddress, setEmailAddress] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [host, setHost] = React.useState(BRIDGE_DEFAULTS.host);
  const [imapPort, setImapPort] = React.useState(
    String(BRIDGE_DEFAULTS.imapPort),
  );
  const [smtpPort, setSmtpPort] = React.useState(
    String(BRIDGE_DEFAULTS.smtpPort),
  );

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/mail/connect/proton", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          emailAddress,
          // Bridge's username is usually the address itself, so an empty
          // field means "the same" rather than "no username".
          username: username.trim() || emailAddress,
          password,
          host: host.trim(),
          imapPort: Number(imapPort),
          smtpPort: Number(smtpPort),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? `Connecting failed (${response.status})`,
        );
      }

      // Clear the password from component state the moment it is no longer
      // needed. It is still in the browser's memory somewhere, but leaving it
      // sitting in a mounted field is a choice rather than a fact.
      setPassword("");
      setConnected(true);
      onConnected?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connecting failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      data-testid="connect-proton"
      className="space-y-5 rounded-lg border border-line bg-surface p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-fg">Proton, via Bridge</h3>
        <p className="mt-1 text-xs text-fg-muted">
          Open Proton Bridge → <strong>Mailbox details</strong>, and copy each
          box below from the box with the same name.
        </p>
      </div>

      {/* Bridge shows these three identically under both IMAP and SMTP. */}
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Same for IMAP and SMTP
        </legend>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="proton-username">Username</Label>
            <Input
              id="proton-username"
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="you@proton.me"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="proton-password">Password</Label>
            <Input
              id="proton-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Bridge's generated password"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="proton-host">Hostname</Label>
            <Input
              id="proton-host"
              required
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
          </div>
        </div>
      </fieldset>

      {/*
        The ports get their own block because they are the field most likely
        to be wrong: Bridge's defaults are 1143/1025, but it moves to the next
        free port without saying so, and a wrong port fails at sync time with
        a connection error rather than here.
      */}
      <fieldset className="space-y-3 rounded-md border border-line bg-surface-muted p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Ports — must match Bridge exactly
        </legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="proton-imap">IMAP port</Label>
            <Input
              id="proton-imap"
              type="number"
              required
              min={1}
              max={65535}
              inputMode="numeric"
              value={imapPort}
              onChange={(event) => setImapPort(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="proton-smtp">SMTP port</Label>
            <Input
              id="proton-smtp"
              type="number"
              required
              min={1}
              max={65535}
              inputMode="numeric"
              value={smtpPort}
              onChange={(event) => setSmtpPort(event.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          This account
        </legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="proton-address">Email address</Label>
            <Input
              id="proton-address"
              type="email"
              required
              value={emailAddress}
              onChange={(event) => setEmailAddress(event.target.value)}
              placeholder="you@proton.me"
            />
          </div>

          {/*
            Security is shown, not asked. Bridge offers STARTTLS and this is
            what the adapter speaks; a dropdown with one correct answer is a
            way to get it wrong. Displaying it lets the owner check it against
            the Security row Bridge shows.
          */}
          <div className="space-y-1">
            <span className="text-sm font-medium text-fg">Security</span>
            <p
              data-testid="proton-security"
              className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-fg-muted"
            >
              STARTTLS — matches Bridge
            </p>
          </div>
        </div>
      </fieldset>

      {error ? (
        <p
          role="alert"
          className="text-sm text-danger"
          data-testid="proton-error"
        >
          {error}
        </p>
      ) : null}

      {connected ? (
        <p
          role="status"
          className="text-sm text-fg"
          data-testid="proton-connected"
        >
          Connected. Mail starts as <strong>metadata only</strong> — set the
          caching policy to Full if you want bodies stored on this box.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Connecting…" : "Connect Proton"}
        </Button>
        <p className="text-xs text-fg-subtle">
          Encrypted on this box. Bridge only answers on this machine, so nothing
          leaves it.
        </p>
      </div>
    </form>
  );
}
