"use client";

import { Plus, Tags } from "lucide-react";
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
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
} from "@/lib/tasks/client";

/**
 * The taxonomy, as something you own.
 *
 * Eight categories are seeded because a blank taxonomy is useless on day one,
 * and the specification calls them *editable defaults* — but they were
 * read-only, which made half of that phrase untrue. They drive the dashboard
 * splits, the hours rollups, the Kanban tags and the report groupings, so
 * being stuck with someone else's words for your own work is a real cost that
 * compounds every time you file something.
 *
 * ── Archive, never delete ────────────────────────────────────────────────
 * Tasks, hours entries and classification rules point at a category, and the
 * reports read months of them. Deleting one would orphan that history or
 * quietly rewrite it. Archiving removes it from every picker and leaves what
 * already happened intact — which is what a ledger owes you.
 *
 * ── Folded away by default ───────────────────────────────────────────────
 * This is a settings screen that happens to live where it is used. It is
 * consulted about once a quarter, so it opens closed rather than occupying
 * the top of a page you visit every day.
 */

const COLORS = [
  { token: "primary", label: "Forest" },
  { token: "accent", label: "Brass" },
  { token: "critical", label: "Critical" },
  { token: "high", label: "High" },
  { token: "normal", label: "Normal" },
  { token: "low", label: "Low" },
  { token: "neutral", label: "Neutral" },
] as const;

export function CategoryManager() {
  const categories = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const list = categories.data ?? [];

  function add() {
    const name = newName.trim();
    if (!name) return;

    createCategory.mutate(
      { name },
      {
        onSuccess: (category) => {
          setNewName("");
          toast({
            title: "Category added",
            description: `“${category.name}” is available everywhere you file things.`,
            tone: "success",
          });
        },
        onError: (error) =>
          toast({
            title: "Couldn't add that",
            description: error.message,
            tone: "danger",
          }),
      },
    );
  }

  function change(
    id: string,
    patch: { name?: string; color?: string; isArchived?: boolean },
  ) {
    updateCategory.mutate(
      { id, ...patch },
      {
        onError: (error) =>
          toast({
            title: "Couldn't save that",
            description: error.message,
            tone: "danger",
          }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <Tags />
            </span>
            Categories
          </CardTitle>
          <CardDescription className="mt-1">
            {list.length} in use. These drive the dashboard splits, the hours
            rollups and the report groupings.
          </CardDescription>
        </div>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Done" : "Edit"}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <ul role="list" className="space-y-2" data-testid="category-list">
            {list.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center gap-2"
              >
                <label className="sr-only" htmlFor={`name-${category.id}`}>
                  Name for {category.name}
                </label>
                <input
                  id={`name-${category.id}`}
                  defaultValue={category.name}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm"
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== category.name) {
                      change(category.id, { name: next });
                    }
                  }}
                />

                <label className="sr-only" htmlFor={`colour-${category.id}`}>
                  Colour for {category.name}
                </label>
                <select
                  id={`colour-${category.id}`}
                  defaultValue={category.color}
                  className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
                  onChange={(event) =>
                    change(category.id, { color: event.target.value })
                  }
                >
                  {COLORS.map((colour) => (
                    <option key={colour.token} value={colour.token}>
                      {colour.label}
                    </option>
                  ))}
                </select>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    change(category.id, { isArchived: true });
                    toast({
                      title: `${category.name} archived`,
                      description:
                        "It is out of the pickers. Everything already filed under it keeps its history.",
                      tone: "neutral",
                    });
                  }}
                >
                  Archive
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <label className="sr-only" htmlFor="new-category">
              New category name
            </label>
            <input
              id="new-category"
              value={newName}
              placeholder="Add a category"
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={add}
              disabled={!newName.trim() || createCategory.isPending}
            >
              <Plus />
              Add
            </Button>
          </div>

          <p className="text-xs text-fg-subtle">
            Archiving keeps the history. Renaming applies everywhere at once —
            past reports included, because they read the category rather than a
            copy of its name.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
