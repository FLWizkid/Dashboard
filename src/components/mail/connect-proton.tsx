"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/**
 * The Proton connect form.
 *
 * Proton is the one account here that cannot be connected by pressing a
 * button and approving a consent screen. Bridge runs on this machine, and
 * what it wants is a host, two ports and the per-application password it
 * generated. That is four fields and a paragraph explaining where to find
 * them, which is worth writing out properly — the alternative is a "Connect"
 * button that opens a flow Proton does not have.
 *
 * The defaults are Bridge's own, so for the ordinary installation the only
 * thing to type is the address and the password.
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
          // Bridge's IMAP username is usually the address itself, so an empty
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
      className="space-y-4 rounded-lg border border-line bg-surface p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-fg">Proton, via Bridge</h3>
        <p className="mt-1 max-w-prose text-xs text-fg-muted">
          Proton has no sync API, so this connects through Proton Bridge running
          on this machine. Open Bridge, choose your account, and copy the
          mailbox configuration it shows — the password there is generated for
          this app and is not your Proton password.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="proton-address">Email address</Label>
          <Input
            id="proton-address"
            type="email"
            required
            autoComplete="username"
            value={emailAddress}
            onChange={(event) => setEmailAddress(event.target.value)}
            placeholder="you@proton.me"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="proton-password">Bridge password</Label>
          <Input
            id="proton-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="proton-username">
            Bridge username <span className="text-fg-subtle">(optional)</span>
          </Label>
          <Input
            id="proton-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Same as the address"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="proton-host">Host</Label>
          <Input
            id="proton-host"
            required
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
          <p className="text-xs text-fg-subtle">
            Bridge is loopback-only, and the server refuses anything else.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="proton-imap">IMAP port</Label>
          <Input
            id="proton-imap"
            type="number"
            required
            min={1}
            max={65535}
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
            value={smtpPort}
            onChange={(event) => setSmtpPort(event.target.value)}
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="text-sm text-danger"
          data-testid="proton-error"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Connecting…" : "Connect Proton"}
        </Button>
        <p className="text-xs text-fg-subtle">
          Stored encrypted on this box. Nothing is sent anywhere else.
        </p>
      </div>
    </form>
  );
}
