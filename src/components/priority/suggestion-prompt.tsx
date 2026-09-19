"use client";

import { CalendarDays, CheckSquare, Link2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  useAnswerSuggestion,
  useRanking,
  type EnrichedSuggestion,
} from "@/lib/priority/client";
import { describeConfidence } from "@/lib/priority/suggest";

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

  const relationLabel =
    suggestion.kind === "prep"
      ? "preparation for"
      : suggestion.kind === "follow_up"
        ? "follow-up from"
        : "related to";

  return (
    <Card data-testid="suggestion-prompt">
      <CardHeader>
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          <span className="[&_svg]:size-3.5">
            <Link2 />
          </span>
          {describeConfidence(suggestion.confidence)}
        </p>
        <CardTitle className="mt-1.5 text-base">
          Is this task {relationLabel} this meeting?
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-start gap-2 text-sm">
            <CheckSquare className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <span>
              <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Task
              </span>
              <br />
              <span className="font-medium text-fg">{taskName}</span>
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <span>
              <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Meeting
              </span>
              <br />
              <span className="font-medium text-fg">{eventName}</span>
              {suggestion.eventStartsAt && (
                <span className="ml-2 text-xs text-fg-subtle">
                  {formatEventTime(suggestion.eventStartsAt)}
                </span>
              )}
            </span>
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
                ? "Link and start a meeting note"
                : "Link and start a follow-up note"}
            </Button>
          )}

          <Button
            size="sm"
            variant="secondary"
            disabled={answer.isPending}
            onClick={() => void respond("dismiss")}
          >
            No, they&rsquo;re not related
          </Button>
        </div>

        <p className="text-xs text-fg-subtle">
          Nothing is linked until you say so, and saying no means this
          won&rsquo;t be suggested again.
        </p>
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
