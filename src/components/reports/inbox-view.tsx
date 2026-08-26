"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailOpen, Send } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { DIGEST_KIND_LABELS } from "@/lib/reports/digest";
import {
  reportKeys,
  useInbox,
  type InboxMessageView,
} from "@/lib/reports/client";
import { cn } from "@/lib/utils";

/**
 * The in-app inbox.
 *
 * Renders the **text** version of each digest, not the HTML. Two reasons: the
 * HTML is built for email clients and carries inline styles that fight the
 * app's own palette in dark mode, and the text rendering is written to be
 * genuinely readable rather than as a stripped-tags afterthought. If it is
 * good enough for a text-only mail client, it is good enough here.
 */
export function InboxView() {
  const inbox = useInbox();
  const [selected, setSelected] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const messages = inbox.data?.messages ?? [];

  const markRead = useMutation({
    mutationFn: async ({ id, read }: { id: string; read: boolean }) => {
      const response = await fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read }),
      });
      if (!response.ok) throw new Error("Couldn't update the message");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: reportKeys.inbox });
    },
  });

  const sendNow = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/digests/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: "daily" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Couldn't generate the brief");
      }
      return (await response.json()) as {
        ran: string[];
        skipped: { reason: string }[];
      };
    },
    onSuccess: (result) => {
      toast({
        title: result.ran.length > 0 ? "Brief generated" : "Already sent",
        description:
          result.ran.length > 0
            ? undefined
            : (result.skipped[0]?.reason ??
              "Today's brief has already gone out."),
        tone: result.ran.length > 0 ? "success" : "neutral",
      });
    },
    onError: (error) => {
      toast({ title: (error as Error).message, tone: "danger" });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: reportKeys.inbox });
    },
  });

  const open = messages.find((message) => message.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            Digest
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Delivered briefs and rollups. Written here first, before any email
            is attempted — so a mail failure never costs you the brief.
          </p>
        </div>

        <Button
          variant="secondary"
          disabled={sendNow.isPending}
          onClick={() => sendNow.mutate()}
        >
          <Send />
          {sendNow.isPending ? "Generating…" : "Generate today's brief"}
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <MessageList
          messages={messages}
          loading={inbox.isLoading}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            const message = messages.find((m) => m.id === id);
            if (message && !message.readAt) markRead.mutate({ id, read: true });
          }}
        />

        {open ? (
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>{open.subject}</CardTitle>
                <CardDescription className="mt-1">
                  {DIGEST_KIND_LABELS[open.kind]} ·{" "}
                  {new Date(open.generatedAt).toLocaleString()}
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  markRead.mutate({ id: open.id, read: open.readAt === null })
                }
              >
                <MailOpen />
                {open.readAt ? "Mark unread" : "Mark read"}
              </Button>
            </CardHeader>
            <CardContent>
              {/* The text rendering, preserved exactly. It was written to be
                  read as plain text; reflowing it would undo that. */}
              <pre
                data-testid="inbox-body"
                className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-fg"
              >
                {open.body}
              </pre>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex min-h-40 items-center justify-center p-8">
              <p className="text-sm text-fg-muted">
                {messages.length === 0
                  ? "No briefs yet. They arrive on the schedule you set."
                  : "Pick a message."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function MessageList({
  messages,
  loading,
  selected,
  onSelect,
}: {
  messages: InboxMessageView[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return <p className="text-sm text-fg-muted">Loading…</p>;
  }

  if (messages.length === 0) {
    return <p className="text-sm text-fg-muted">Nothing delivered yet.</p>;
  }

  return (
    <ul
      className="divide-y divide-line rounded-lg border border-line bg-surface-raised"
      data-testid="inbox-list"
    >
      {messages.map((message) => (
        <li key={message.id}>
          <button
            type="button"
            data-testid="inbox-item"
            aria-current={message.id === selected ? "true" : undefined}
            onClick={() => onSelect(message.id)}
            className={cn(
              "w-full px-3 py-2.5 text-left transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              message.id === selected
                ? "bg-primary-soft"
                : "hover:bg-surface-muted",
            )}
          >
            <span className="flex items-baseline gap-2">
              {/* Unread is a dot, not bold text: bold changes the line's width
                  and the list shifts as you read it. */}
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  message.readAt ? "bg-transparent" : "bg-primary",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  message.id === selected
                    ? "font-medium text-primary-soft-fg"
                    : "text-fg",
                )}
              >
                {message.subject}
                {!message.readAt && <span className="sr-only"> (unread)</span>}
              </span>
            </span>

            <span
              className={cn(
                "mt-0.5 block truncate pl-3.5 text-xs",
                message.id === selected
                  ? "text-primary-soft-fg"
                  : "text-fg-muted",
              )}
            >
              {message.preview}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
