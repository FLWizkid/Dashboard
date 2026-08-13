"use client";

import { Link2, X } from "lucide-react";
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
import { useAnswerSuggestion, useRanking } from "@/lib/priority/client";
import { describeConfidence, phraseQuestion } from "@/lib/priority/suggest";
import type { StoredSuggestion } from "@/lib/priority/repository";

/**
 * Confirm-before-link, as a question the owner answers.
 *
 * Three things this component is careful about:
 *
 * **Nothing happens until they answer.** No link exists, and the ranking is
 * not moved by the suggestion — see `rankTasks`, which counts confirmed links
 * only. A suggestion sitting here unanswered has no effect on anything.
 *
 * **The note is a separate yes.** Agreeing that a task relates to a meeting
 * and wanting a note about it are different decisions. Bundling them is how
 * you end up with a vault full of empty notes nobody asked for, so the note is
 * its own button rather than a checkbox that defaults to on.
 *
 * **Dismissing means never asking again.** Not "not now" — the answer is
 * recorded, and detection skips the pair from then on. A prompt that comes
 * back after you have said no is a nag, and a nag gets dismissed unread, which
 * costs the good suggestions too.
 */
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

function SuggestionPrompt({ suggestion }: { suggestion: StoredSuggestion }) {
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

  return (
    <Card data-testid="suggestion-prompt">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <Link2 />
            </span>
            {describeConfidence(suggestion.confidence)}
          </CardTitle>
          <CardDescription className="mt-1">
            {suggestion.reason}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-fg">{phraseQuestion(suggestion)}</p>

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
            variant="ghost"
            disabled={answer.isPending}
            onClick={() => void respond("dismiss")}
          >
            <X />
            No
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
