"use client";

import { ArrowRight, CalendarDays, CheckSquare } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  useAnswerSuggestion,
  useRanking,
  type EnrichedSuggestion,
} from "@/lib/priority/client";

export function SuggestionPrompts() {
  const ranking = useRanking();
  const suggestions = ranking.data?.suggestions ?? [];

  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-heading" className="space-y-2">
      <h2 id="suggestions-heading" className="sr-only">
        Suggested links
      </h2>

      {suggestions.map((suggestion) => (
        <SuggestionPrompt key={suggestion.id} suggestion={suggestion} />
      ))}
    </section>
  );
}

function SuggestionPrompt({
  suggestion,
}: {
  suggestion: EnrichedSuggestion;
}) {
  const answer = useAnswerSuggestion();
  const { toast } = useToast();

  const respond = async (decision: "accept" | "dismiss", withNote = false) => {
    await answer.mutateAsync({ id: suggestion.id, decision, withNote });

    toast({
      title:
        decision === "dismiss"
          ? "Won't ask again"
          : withNote
            ? "Linked, and a note is waiting"
            : "Linked",
      tone: decision === "dismiss" ? "neutral" : "success",
    });
  };

  const wantsNote = suggestion.kind !== "related";
  const taskName = suggestion.taskTitle ?? "Untitled task";
  const eventName = suggestion.eventTitle ?? "Untitled event";

  const relationVerb =
    suggestion.kind === "prep"
      ? "may be preparation for"
      : suggestion.kind === "follow_up"
        ? "may be a follow-up from"
        : "may be related to";

  return (
    <Card data-testid="suggestion-prompt">
      <CardContent className="space-y-3 pt-5">
        {/* Task -- from the task list */}
        <div className="flex items-start gap-2">
          <CheckSquare className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg-subtle">
              From your task list
            </p>
            <Link
              href={`/dashboard/tasks?task=${suggestion.taskId}`}
              className="block truncate text-base font-semibold text-fg underline decoration-line/50 underline-offset-2 hover:decoration-fg"
            >
              {taskName}
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 pl-6 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          <ArrowRight className="size-3" />
          <span>{relationVerb}</span>
        </div>

        {/* Event -- from the calendar */}
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg-subtle">
              From your calendar
            </p>
            <Link
              href="/dashboard/calendar"
              className="block truncate text-base font-semibold text-fg underline decoration-line/50 underline-offset-2 hover:decoration-fg"
            >
              {eventName}
            </Link>
            {suggestion.eventStartsAt && (
              <p className="text-xs text-fg-subtle">
                {formatEventTime(suggestion.eventStartsAt)}
              </p>
            )}
          </div>
        </div>

        <p className="text-xs text-fg-subtle">{suggestion.reason}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={answer.isPending}
            onClick={() => void respond("accept")}
          >
            Yes, link them
          </Button>

          {wantsNote && (
            <Button
              size="sm"
              variant="secondary"
              disabled={answer.isPending}
              onClick={() => void respond("accept", true)}
            >
              {suggestion.kind === "prep"
                ? "Link + meeting note"
                : "Link + follow-up note"}
            </Button>
          )}

          <Button
            size="sm"
            variant="secondary"
            disabled={answer.isPending}
            onClick={() => void respond("dismiss")}
          >
            Not related
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatEventTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
