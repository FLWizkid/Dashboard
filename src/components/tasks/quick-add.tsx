"use client";

import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import {
  CalendarClock,
  CornerDownLeft,
  Flag,
  Folder,
  Link2,
  Plus,
  Sparkles,
  User,
  X,
} from "lucide-react";
import * as React from "react";

import { useSettings } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { DURATION, EASE } from "@/lib/motion";
import { parseQuickAdd, type EventReference } from "@/lib/quick-add/parse";
import type { CreateTaskPayload } from "@/lib/tasks/schema";
import { describeMissingReadyFields } from "@/lib/tasks/ready";
import {
  LINK_RELATION_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ActivityCategory,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/types";
import { formatDueDate, toDateTimeLocalValue } from "@/lib/time/format";
import { zonedTimeToUtc } from "@/lib/time/zone";
import { cn } from "@/lib/utils";

type Field = "dueAt" | "priority" | "categoryId" | "owner";

interface Draft {
  title: string;
  dueAt: string | null;
  priority: TaskPriority | null;
  categoryId: string | null;
  owner: string | null;
  /**
   * Which lane it lands in.
   *
   * Capture used to hard-code Inbox and leave the lane to a later drag. That
   * is right for the one-line case and wrong for the other one: a task you
   * are typing out in full — owner, due date, category — is a task you have
   * already thought about, and making you find it on the board afterwards to
   * say so is a second trip for something you knew at the time.
   *
   * `done` is offered too. Logging something you have already finished is a
   * real thing people do, and refusing it just means it gets created and
   * immediately ticked.
   */
  status: TaskStatus;
  notes: string;
  eventRef: EventReference | null;
  /** Confirm-before-link: false until the owner says yes, explicitly. */
  eventConfirmed: boolean;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  dueAt: null,
  priority: null,
  categoryId: null,
  owner: null,
  status: "inbox",
  notes: "",
  eventRef: null,
  eventConfirmed: false,
};

function localInputToIso(value: string, timeZone: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return zonedTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: 0,
    },
    timeZone,
  ).toISOString();
}

/**
 * Single-line capture with smart parsing.
 *
 * The rules this component enforces, which matter more than how it looks:
 *   • Every parsed value is a *suggestion*. Touching a field pins it, and the
 *     parser stops overwriting it for the rest of the capture.
 *   • A detected event reference is never linked silently. It renders as an
 *     explicit ask with Link / Not now, and an unanswered ask means no link.
 *   • Enter always captures. A task that isn't Ready yet still gets saved —
 *     into Inbox, badged with what it is missing. Capture must never be
 *     blocked by triage.
 */
export function QuickAdd({
  categories,
  onCreate,
  pending,
}: {
  categories: ActivityCategory[];
  onCreate: (payload: CreateTaskPayload) => void;
  pending: boolean;
}) {
  const reduced = useReducedMotion();
  const { timeZone, defaultDueHour, ready: settingsReady } = useSettings();

  const [raw, setRaw] = React.useState("");
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [unknownTag, setUnknownTag] = React.useState<string | null>(null);
  const [pinnedFields, setPinnedFields] = React.useState<Set<Field>>(new Set());
  /**
   * The full form is open from the start.
   *
   * It used to be collapsed, on the theory that capture should be one line
   * and triage should come later. That theory holds for a thought caught on
   * the way into a meeting, and the single line still does exactly that —
   * type, press Enter, done, the fields left empty.
   *
   * What it got wrong is the other half. When you sit down to write a real
   * task you already know its owner, its lane and its due date, and hiding
   * those behind a "Details" button turns one action into three: capture,
   * find it again, fill it in. The owner's words were that the whole section
   * should be part of the initial create.
   *
   * So it opens, and the disclosure stays — collapsing it is now a way to get
   * a narrower box, not a prerequisite for using the fields.
   */
  const [detailsOpen, setDetailsOpen] = React.useState(true);
  const [now, setNow] = React.useState<Date | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const dueRef = React.useRef<HTMLInputElement>(null);
  const priorityRef = React.useRef<HTMLSelectElement>(null);
  const categoryRef = React.useRef<HTMLSelectElement>(null);
  const ownerRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setNow(new Date());
  }, []);

  const parseCategories = React.useMemo(
    () => categories.map((item) => ({ slug: item.slug, name: item.name })),
    [categories],
  );

  /**
   * Re-parse on every keystroke and fold the result into the draft, leaving
   * any field the owner has touched alone.
   */
  const handleChange = React.useCallback(
    (value: string) => {
      setRaw(value);

      if (!value.trim()) {
        setDraft((current) => ({ ...EMPTY_DRAFT, notes: current.notes }));
        setUnknownTag(null);
        return;
      }

      const parsed = parseQuickAdd(value, {
        now: new Date(),
        timeZone,
        categories: parseCategories,
        defaultDueHour,
      });

      setUnknownTag(parsed.unknownTag);

      setDraft((current) => {
        const next: Draft = { ...current, title: parsed.title };

        if (!pinnedFields.has("dueAt")) {
          next.dueAt = parsed.dueAt?.value ?? null;
        }
        if (!pinnedFields.has("priority")) {
          next.priority = parsed.priority?.value ?? null;
        }
        if (!pinnedFields.has("categoryId")) {
          const slug = parsed.categorySlug?.value;
          next.categoryId = slug
            ? (categories.find((item) => item.slug === slug)?.id ?? null)
            : null;
        }
        if (!pinnedFields.has("owner")) {
          next.owner = parsed.owner?.value ?? null;
        }

        const label = parsed.eventRef?.value.label ?? null;
        if (label !== (current.eventRef?.label ?? null)) {
          // A different event was detected — the previous confirmation can't
          // carry over to it.
          next.eventRef = parsed.eventRef?.value ?? null;
          next.eventConfirmed = false;
        }

        return next;
      });
    },
    [categories, defaultDueHour, parseCategories, pinnedFields, timeZone],
  );

  /*
   * Re-parse when the inputs the parser depends on arrive.
   *
   * The taxonomy is fetched and the timezone is resolved in an effect, so
   * both can land *after* the owner has started typing. Without this, typing
   * "#strategic" in the first moment after a page load would leave the
   * category unresolved for the rest of the capture. Fields the owner has
   * touched are still left alone — re-parsing goes through the same path.
   */
  const handleChangeRef = React.useRef(handleChange);
  const rawRef = React.useRef(raw);
  React.useEffect(() => {
    handleChangeRef.current = handleChange;
    rawRef.current = raw;
  });

  React.useEffect(() => {
    if (rawRef.current.trim()) handleChangeRef.current(rawRef.current);
  }, [categories, timeZone, defaultDueHour]);

  function pin(field: Field) {
    setPinnedFields((current) => new Set(current).add(field));
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function clearField(field: Field) {
    pin(field);
    update(field, null as never);
  }

  function openDetails(focus?: React.RefObject<HTMLElement | null>) {
    setDetailsOpen(true);
    // Wait for the panel to exist before moving focus into it.
    window.requestAnimationFrame(() => focus?.current?.focus());
  }

  function reset() {
    setRaw("");
    setDraft(EMPTY_DRAFT);
    setUnknownTag(null);
    setPinnedFields(new Set());
    setDetailsOpen(false);
  }

  function submit() {
    const title = draft.title.trim() || raw.trim();
    if (!title) return;

    onCreate({
      title,
      notes: draft.notes.trim() || null,
      priority: draft.priority,
      dueAt: draft.dueAt,
      categoryId: draft.categoryId,
      status: draft.status,
      pinned: false,
      sourceLink: null,
      // Quick-add is a deliberate capture, so it is live work, never a draft.
      isDraft: false,
      owner: draft.owner,
      // Set by the capture queue if this ever has to be held on the device;
      // an online capture has nothing to replay and so needs no key.
      clientKey: null,
      links:
        draft.eventRef && draft.eventConfirmed
          ? [
              {
                kind: "event" as const,
                relation: draft.eventRef.relation,
                // Unresolved until a calendar provider is connected (Phase 2).
                targetId: null,
                targetLabel: draft.eventRef.label,
                targetUrl: null,
                confirmed: true,
              },
            ]
          : [],
    });

    reset();
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (detailsOpen) setDetailsOpen(false);
      else if (raw) reset();
      else inputRef.current?.blur();
    }
  }

  const missing = describeMissingReadyFields({
    title: draft.title || raw,
    priority: draft.priority,
    dueAt: draft.dueAt,
  });

  const hasSuggestions =
    draft.dueAt !== null ||
    draft.priority !== null ||
    draft.categoryId !== null ||
    draft.owner !== null;

  const selectedCategory = categories.find(
    (item) => item.id === draft.categoryId,
  );

  return (
    <div className="rounded-lg border border-line bg-surface-raised">
      <div className="flex items-center gap-2 p-2">
        <Plus
          aria-hidden="true"
          className="ml-1 size-4 shrink-0 text-fg-subtle"
        />
        <input
          ref={inputRef}
          id="quick-add-input"
          data-testid="quick-add-input"
          value={raw}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a task — try “Draft board deck !high friday 3pm #strategic”"
          aria-label="Add a task"
          aria-describedby="quick-add-hint"
          autoComplete="off"
          maxLength={500}
          className={cn(
            "min-w-0 flex-1 bg-transparent py-2 text-sm text-fg outline-none",
            "placeholder:text-fg-subtle",
          )}
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || !(draft.title.trim() || raw.trim())}
          data-testid="quick-add-submit"
        >
          Add
          <Kbd
            aria-hidden="true"
            className="border-primary-fg/30 bg-transparent text-primary-fg"
          >
            <CornerDownLeft className="size-2.5" />
          </Kbd>
        </Button>
      </div>

      <p id="quick-add-hint" className="sr-only">
        Type a task. Dates, priority, category and owner are detected
        automatically and can be edited before you press Enter to add.
      </p>

      {/* Parsed suggestions — each one editable, each one clearable. */}
      <AnimatePresence initial={false}>
        {raw.trim() ? (
          <m.div
            key="suggestions"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{
              duration: reduced ? 0 : DURATION.base,
              ease: EASE.out,
            }}
            className="overflow-hidden border-t border-line"
          >
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
              {hasSuggestions ? (
                <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
                  <Sparkles aria-hidden="true" className="size-3" />
                  Detected
                </span>
              ) : null}

              {draft.dueAt && now && settingsReady ? (
                <SuggestionChip
                  icon={<CalendarClock aria-hidden="true" />}
                  label={formatDueDate(draft.dueAt, now, timeZone)}
                  editLabel="Edit due date"
                  clearLabel="Clear due date"
                  onEdit={() => openDetails(dueRef)}
                  onClear={() => clearField("dueAt")}
                />
              ) : null}

              {draft.priority ? (
                <SuggestionChip
                  icon={<Flag aria-hidden="true" />}
                  label={PRIORITY_LABELS[draft.priority]}
                  editLabel="Edit priority"
                  clearLabel="Clear priority"
                  onEdit={() => openDetails(priorityRef)}
                  onClear={() => clearField("priority")}
                />
              ) : null}

              {selectedCategory ? (
                <SuggestionChip
                  icon={<Folder aria-hidden="true" />}
                  label={selectedCategory.name}
                  editLabel="Edit category"
                  clearLabel="Clear category"
                  onEdit={() => openDetails(categoryRef)}
                  onClear={() => clearField("categoryId")}
                />
              ) : null}

              {draft.owner ? (
                <SuggestionChip
                  icon={<User aria-hidden="true" />}
                  label={draft.owner}
                  editLabel="Edit owner"
                  clearLabel="Clear owner"
                  onEdit={() => openDetails(ownerRef)}
                  onClear={() => clearField("owner")}
                />
              ) : null}

              {unknownTag ? (
                // The tag stays in the title (stripping it would lose what
                // was typed) — but say so, instead of storing silent noise.
                <Badge tone="outline" className="border-dashed">
                  {unknownTag} isn&rsquo;t a category — it stays in the title
                </Badge>
              ) : null}

              {missing ? (
                <Badge tone="outline" className="border-dashed">
                  {missing} to be Ready
                </Badge>
              ) : (
                <Badge tone="primary">Ready</Badge>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                aria-controls="quick-add-details"
              >
                {detailsOpen ? "Hide details" : "Details"}
              </Button>
            </div>

            {/*
              Confirm-before-link. This is a question, not a notification:
              nothing is linked unless "Link it" is pressed.
            */}
            {draft.eventRef ? (
              <div
                data-testid="event-link-confirm"
                className="flex flex-wrap items-center gap-2 border-t border-line bg-accent-soft/60 px-3 py-2"
              >
                <Link2 aria-hidden="true" className="size-3.5 text-accent" />
                <p className="text-xs text-fg">
                  Looks like{" "}
                  <span className="font-medium">
                    {LINK_RELATION_LABELS[
                      draft.eventRef.relation
                    ].toLowerCase()}
                  </span>{" "}
                  an event called{" "}
                  <span className="font-medium">“{draft.eventRef.label}”</span>.
                  Link it?
                </p>
                {draft.eventConfirmed ? (
                  <Badge tone="primary">Will link on add</Badge>
                ) : null}
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant={draft.eventConfirmed ? "secondary" : "primary"}
                    onClick={() =>
                      update("eventConfirmed", !draft.eventConfirmed)
                    }
                    data-testid="event-link-confirm-button"
                  >
                    {draft.eventConfirmed ? "Undo link" : "Link it"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      update("eventRef", null);
                      update("eventConfirmed", false);
                    }}
                  >
                    Not now
                  </Button>
                </div>
              </div>
            ) : null}
          </m.div>
        ) : null}
      </AnimatePresence>

      {/* Expandable details — the same fields, as real controls. */}
      <AnimatePresence initial={false}>
        {detailsOpen ? (
          <m.div
            id="quick-add-details"
            key="details"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{
              duration: reduced ? 0 : DURATION.base,
              ease: EASE.out,
            }}
            className="overflow-hidden border-t border-line"
          >
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="quick-add-due">Due</Label>
                <Input
                  ref={dueRef}
                  id="quick-add-due"
                  type="datetime-local"
                  value={
                    draft.dueAt
                      ? toDateTimeLocalValue(draft.dueAt, timeZone)
                      : ""
                  }
                  onChange={(event) => {
                    pin("dueAt");
                    update(
                      "dueAt",
                      localInputToIso(event.target.value, timeZone),
                    );
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="quick-add-priority">Priority</Label>
                <Select
                  ref={priorityRef}
                  id="quick-add-priority"
                  value={draft.priority ?? ""}
                  onChange={(event) => {
                    pin("priority");
                    update(
                      "priority",
                      event.target.value === ""
                        ? null
                        : (event.target.value as TaskPriority),
                    );
                  }}
                >
                  <option value="">Untriaged</option>
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="quick-add-category">Category</Label>
                <Select
                  ref={categoryRef}
                  id="quick-add-category"
                  value={draft.categoryId ?? ""}
                  onChange={(event) => {
                    pin("categoryId");
                    update("categoryId", event.target.value || null);
                  }}
                >
                  <option value="">No category</option>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="quick-add-status">Status</Label>
                <Select
                  id="quick-add-status"
                  value={draft.status}
                  onChange={(event) =>
                    update("status", event.target.value as TaskStatus)
                  }
                  data-testid="quick-add-status"
                >
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
                {/* Not a pinnable field: nothing in the parser sets a lane, so
                    there is no suggestion here for a pin to protect. */}
              </div>

              <div className="space-y-1">
                <Label htmlFor="quick-add-owner">Owner (optional)</Label>
                <Input
                  ref={ownerRef}
                  id="quick-add-owner"
                  value={draft.owner ?? ""}
                  maxLength={120}
                  placeholder="You"
                  onChange={(event) => {
                    pin("owner");
                    update("owner", event.target.value || null);
                  }}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="quick-add-notes">Notes</Label>
                <Textarea
                  id="quick-add-notes"
                  value={draft.notes}
                  maxLength={20_000}
                  onChange={(event) => update("notes", event.target.value)}
                />
              </div>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SuggestionChip({
  icon,
  label,
  editLabel,
  clearLabel,
  onEdit,
  onClear,
}: {
  icon: React.ReactNode;
  label: string;
  editLabel: string;
  clearLabel: string;
  onEdit: () => void;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center rounded-full bg-primary-soft text-xs text-primary-soft-fg">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${editLabel} (${label})`}
        className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 font-medium [&_svg]:size-3"
      >
        {icon}
        {label}
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="rounded-full py-0.5 pl-0.5 pr-1.5 opacity-70 transition-opacity duration-fast hover:opacity-100"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}
