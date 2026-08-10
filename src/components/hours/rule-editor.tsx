"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { RULE_FIELDS, type RuleField } from "@/lib/hours/classify";
import {
  useCreateRule,
  useDeleteRule,
  useRules,
  useUpdateRule,
} from "@/lib/hours/client";
import { useCategories } from "@/lib/tasks/client";
import type { WorkCategoryRule } from "@/lib/hours/types";

/**
 * The classification rules.
 *
 * Order is the feature. First match wins, so a list you can reorder is the
 * difference between "board" catching your board meeting and "meeting"
 * swallowing it first — and the numbers next to each rule say so plainly
 * rather than leaving it to be discovered.
 *
 * Reordering is buttons, not drag: the list is short, the keyboard has to work
 * anyway, and a drag handle that is the only way to move a rule is a rule you
 * can't move on a phone.
 */

const FIELD_LABELS: Record<RuleField, string> = {
  title: "title",
  location: "location",
  organizer: "organiser",
  attendee: "an attendee",
};

export function RuleEditor() {
  const rules = useRules();
  const categories = useCategories();
  const create = useCreateRule();
  const update = useUpdateRule();
  const remove = useDeleteRule();

  const [pattern, setPattern] = React.useState("");
  const [field, setField] = React.useState<RuleField>("title");
  const [categoryId, setCategoryId] = React.useState("");
  const [counts, setCounts] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const list = rules.data ?? [];

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (pattern.trim().length < 2) {
      setError("A pattern needs at least two characters.");
      return;
    }

    try {
      await create.mutateAsync({
        pattern: pattern.trim(),
        field,
        categoryId: categoryId || null,
        countsTowardHours: counts,
        isEnabled: true,
      });
      setPattern("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't add it.");
    }
  };

  /**
   * Moving a rule swaps its position with its neighbour's rather than
   * renumbering the list. Two writes instead of N, and a failed second write
   * leaves a duplicate position — which the classifier breaks by id, so the
   * order stays deterministic either way.
   */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;

    const a = list[index];
    const b = list[target];

    await Promise.all([
      update.mutateAsync({ id: a.id, patch: { position: b.position } }),
      update.mutateAsync({ id: b.id, patch: { position: a.position } }),
    ]);
  };

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Classification rules</CardTitle>
          <CardDescription className="mt-1">
            Applied in order — the first one that matches decides. A category
            you set by hand on an event always beats every rule here.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {list.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No rules yet. Without them, meetings fall back to the calendar
            default, and anything unclassified doesn&rsquo;t count toward your
            hours.
          </p>
        ) : (
          <ol className="divide-y divide-line" data-testid="rule-list">
            {list.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={index}
                total={list.length}
                categoryName={
                  categories.data?.find((c) => c.id === rule.categoryId)?.name
                }
                onMove={(direction) => void move(index, direction)}
                onToggle={() =>
                  void update.mutateAsync({
                    id: rule.id,
                    patch: { isEnabled: !rule.isEnabled },
                  })
                }
                onDelete={() => void remove.mutateAsync(rule.id)}
              />
            ))}
          </ol>
        )}

        <form
          onSubmit={add}
          className="space-y-3 rounded-md border border-dashed border-line-strong p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="rule-pattern">When the</Label>
              <div className="flex gap-2">
                <Select
                  aria-label="Field to match"
                  className="w-32 shrink-0"
                  value={field}
                  onChange={(event) =>
                    setField(event.target.value as RuleField)
                  }
                >
                  {RULE_FIELDS.map((value) => (
                    <option key={value} value={value}>
                      {FIELD_LABELS[value]}
                    </option>
                  ))}
                </Select>
                <Input
                  id="rule-pattern"
                  value={pattern}
                  maxLength={200}
                  placeholder="contains… e.g. board"
                  onChange={(event) => setPattern(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-category">Then categorise as</Label>
              <Select
                id="rule-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">No category</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-counts">And</Label>
              <Select
                id="rule-counts"
                value={counts ? "count" : "exclude"}
                onChange={(event) => setCounts(event.target.value === "count")}
              >
                <option value="count">count it toward hours</option>
                <option value="exclude">don&rsquo;t count it</option>
              </Select>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-priority-critical">
              {error}
            </p>
          )}

          <Button type="submit" size="sm" disabled={create.isPending}>
            <Plus />
            Add rule
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RuleRow({
  rule,
  index,
  total,
  categoryName,
  onMove,
  onToggle,
  onDelete,
}: {
  rule: WorkCategoryRule;
  index: number;
  total: number;
  categoryName: string | undefined;
  onMove: (direction: -1 | 1) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 text-sm">
      <span
        className="flex w-6 shrink-0 items-center gap-1 text-xs tabular-nums text-fg-subtle"
        aria-hidden="true"
      >
        <GripVertical className="size-3" />
        {index + 1}
      </span>

      <span
        className={
          rule.isEnabled
            ? "min-w-0 flex-1 text-fg"
            : "min-w-0 flex-1 text-fg-subtle line-through"
        }
      >
        {FIELD_LABELS[rule.field]} contains{" "}
        <strong className="font-medium">“{rule.pattern}”</strong>
        {" → "}
        {rule.countsTowardHours ? (
          <>{categoryName ?? "no category"}, counts</>
        ) : (
          <span className="text-fg-muted">excluded from hours</span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={`Move “${rule.pattern}” earlier`}
        >
          ↑
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label={`Move “${rule.pattern}” later`}
        >
          ↓
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggle}
          aria-pressed={rule.isEnabled}
        >
          {rule.isEnabled ? "Disable" : "Enable"}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={`Delete the rule for “${rule.pattern}”`}
        >
          <Trash2 />
        </Button>
      </span>
    </li>
  );
}
