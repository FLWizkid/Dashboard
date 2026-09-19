"use client";

import { ArrowRight, CalendarDays, CheckSquare } from "lucide-react";
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
      ? "Preparation for"
      : suggestion.kind === "follow_up"
        ? "Follow-up from"
        : "Related to";

  return (
    <Card data-testid="suggestion-prompt">
      <CardContent className="space-y-3 pt-5">
        {/* The two names are the card. Everything else is secondary. */}
        <div className="flex items-start gap-2">
          <CheckSquare className="mt-1 size-4 shrink-0 text-fg-subtle" />
          <p className="text-base font-semibold text-fg">{taskName}</p>
        </div>

        <div className="flex items-center gap-2 pl-6 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          <ArrowRight className="size-3" />
          <span>{relationVerb}</span>
        </div>

        <div className="flex items-start gap-2">
          <CalendarDays className="mt-1 size-4 shrink-0 text-fg-subtle" />
          <div>
            <p className="text-base font-semibold text-fg">{eventName}</p>
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
