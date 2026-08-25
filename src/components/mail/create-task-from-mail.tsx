"use client";

import { CheckCircle2, ListPlus } from "lucide-react";
import { useState } from "react";

import type { TaskSuggestion } from "@/lib/mail/to-task";
import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";

/**
 * Turn a message into a task.
 *
 * ── Suggested, never forced ──────────────────────────────────────────────
 * Nothing happens until this is pressed, and what appears then is a proposal:
 * a title, a due date and a priority, each captioned with the reason it was
 * chosen. Every field is editable before anything is created, and the
 * proposed *event* link is a separate question again — the same
 * confirm-before-link rule quick-add follows. An assistant that quietly
 * created tasks from mail would be a machine for generating work you did not
 * agree to.
 */

interface Props {
  messageId: string;
  onCreated?: (taskId: string) => void;
}

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "review"; suggestion: TaskSuggestion }
  | { phase: "created" }
  | { phase: "error"; message: string };

export function CreateTaskFromMail({ messageId, onCreated }: Props) {
  const { timeZone } = useSettings();
  const [state, setState] = useState<State>({ phase: "idle" });

  // Editable copies of the suggestion. Kept separate from the suggestion
  // itself so the reasons stay visible next to what they explain, even after
  // the value has been overridden.
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("");
  const [linkEvent, setLinkEvent] = useState(false);

  async function propose() {
    setState({ phase: "loading" });
    try {
      const response = await fetch(
        `/api/mail/messages/${messageId}/suggest-task?timeZone=${encodeURIComponent(timeZone)}`,
      );
      if (!response.ok) throw new Error(await readError(response));

      const { suggestion } = (await response.json()) as {
        suggestion: TaskSuggestion;
      };

      setTitle(suggestion.title);
      setDueAt(suggestion.due ? toLocalInput(suggestion.due.value) : "");
      setPriority(suggestion.priority?.value ?? "");
      // Unconfirmed by default. The event link is a guess.
      setLinkEvent(false);
      setState({ phase: "review", suggestion });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function create(suggestion: TaskSuggestion) {
    setState({ phase: "loading" });
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          priority: priority || null,
          status: "inbox",
          links: [
            {
              // Always linked, and legitimately `confirmed`: pressing "create
              // task" on this message *is* the confirmation that the task
              // came from it. The guessed link below is a different matter.
              kind: "message" as const,
              relation: "source" as const,
              targetId: suggestion.sourceMessageId,
              targetLabel: suggestion.title,
              confirmed: true,
            },
            ...(linkEvent && suggestion.relatedEvent
              ? [
                  {
                    kind: "event" as const,
                    relation: "related" as const,
                    targetId: suggestion.relatedEvent.eventId,
                    targetLabel: suggestion.relatedEvent.title,
                    // Only ever true because the checkbox was ticked.
                    confirmed: true,
                  },
                ]
              : []),
          ],
        }),
      });

      if (!response.ok) throw new Error(await readError(response));
      const created = (await response.json()) as { task?: { id: string } };

      setState({ phase: "created" });
      if (created.task?.id) onCreated?.(created.task.id);
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (state.phase === "created") {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
        <CheckCircle2 className="size-4 text-accent" aria-hidden />
        Task created and linked to this mail.
      </p>
    );
  }

  if (state.phase === "idle" || state.phase === "loading") {
    return (
      <div className="mt-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={propose}
          disabled={state.phase === "loading"}
        >
          <ListPlus className="size-4" aria-hidden />
          {state.phase === "loading" ? "Reading…" : "Create task"}
        </Button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="mt-3 space-y-2">
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={propose}>
          Try again
        </Button>
      </div>
    );
  }

  const { suggestion } = state;

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-line bg-surface-muted p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void create(suggestion);
      }}
    >
      <div className="space-y-1">
        <label
          className="text-xs font-medium text-fg"
          htmlFor={`task-title-${messageId}`}
        >
          Task
        </label>
        <input
          id={`task-title-${messageId}`}
          className="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            className="text-xs font-medium text-fg"
            htmlFor={`task-due-${messageId}`}
          >
            Due
          </label>
          <input
            id={`task-due-${messageId}`}
            type="datetime-local"
            className="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
          {/* The reason the suggestion exists, kept beside it. A suggested
              date with no stated reason is indistinguishable from a guess. */}
          {suggestion.due && (
            <p className="text-xs text-fg-muted">{suggestion.due.reason}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            className="text-xs font-medium text-fg"
            htmlFor={`task-priority-${messageId}`}
          >
            Priority
          </label>
          <select
            id={`task-priority-${messageId}`}
            className="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="">Not set</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          {suggestion.priority && (
            <p className="text-xs text-fg-muted">
              {suggestion.priority.reason}
            </p>
          )}
        </div>
      </div>

      {suggestion.relatedEvent && (
        <div className="space-y-1 rounded border border-line bg-surface p-2">
          <p className="text-xs text-fg">
            Is this about “{suggestion.relatedEvent.title}”?
          </p>
          <p className="text-xs text-fg-muted">
            {suggestion.relatedEvent.reason}
          </p>
          <label className="flex items-center gap-2 text-xs text-fg">
            <input
              type="checkbox"
              checked={linkEvent}
              onChange={(event) => setLinkEvent(event.target.checked)}
            />
            Link it to that meeting
          </label>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!title.trim()}>
          Create task
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setState({ phase: "idle" })}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

/** ISO instant to the value a `datetime-local` input expects. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
