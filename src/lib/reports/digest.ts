/**
 * Composing a digest.
 *
 * Three kinds, all built from the same summary the on-screen report uses:
 *
 *   **daily**   the morning brief — what today looks like
 *   **weekly**  hours and activity for the week just finished
 *   **monthly** the same, over a month
 *
 * ── Why the HTML is written by hand ──────────────────────────────────────
 * No template engine, no React renderer, no CSS framework. Email clients are
 * a decade behind browsers and the reliable subset is: tables, inline styles,
 * and nothing else. A digest that renders beautifully in a preview and
 * collapses in Outlook is worse than a plain one, so this produces plain
 * markup with inline styles and a **text alternative that is genuinely
 * readable** rather than a stripped-tags afterthought.
 *
 * ── Why every digest is also plain text ──────────────────────────────────
 * The in-app inbox renders the text version. So does any client that refuses
 * HTML. Writing it properly costs a few lines and means the brief is never
 * unreadable.
 */

import { formatMinutes } from "@/lib/hours/aggregate";
import type { Task } from "@/lib/tasks/types";

import type { GroupedTasks } from "./group";
import type { ActivitySplit, ExecutiveSummary, TwoDaySlot } from "./summary";

export const DIGEST_KINDS = ["daily", "weekly", "monthly"] as const;
export type DigestKind = (typeof DIGEST_KINDS)[number];

export const DIGEST_KIND_LABELS: Record<DigestKind, string> = {
  daily: "Morning brief",
  weekly: "Weekly rollup",
  monthly: "Monthly rollup",
};

export interface DigestInput {
  kind: DigestKind;
  /** The instant the digest describes. */
  generatedAt: Date;
  timeZone: string;
  summary: ExecutiveSummary;
  /** Present in the daily brief. */
  twoDay?: TwoDaySlot[];
  /** Present in the weekly and monthly rollups. */
  splits?: ActivitySplit[];
  /** Present in the daily brief: the grouped task list, trimmed. */
  groups?: GroupedTasks[];
  /** Where the app lives, for the "open the dashboard" link. */
  baseUrl?: string;
}

export interface Digest {
  kind: DigestKind;
  subject: string;
  /** For the in-app inbox and text-only mail clients. */
  text: string;
  /** For HTML mail. Inline styles only. */
  html: string;
  /** One line, for the inbox list. */
  preview: string;
  generatedAt: string;
}

/* ── Composition ──────────────────────────────────────────────────────── */

export function composeDigest(input: DigestInput): Digest {
  const subject = subjectFor(input);
  const text = renderText(input);

  return {
    kind: input.kind,
    subject,
    text,
    html: renderHtml(input, subject),
    preview: previewFor(input),
    generatedAt: input.generatedAt.toISOString(),
  };
}

function subjectFor(input: DigestInput): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: input.timeZone,
    day: "numeric",
    month: "long",
  }).format(input.generatedAt);

  switch (input.kind) {
    case "daily":
      return `Morning brief — ${date}`;
    case "weekly":
      return `Week in review — ${date}`;
    case "monthly":
      return `Month in review — ${date}`;
  }
}

/**
 * The one-line preview.
 *
 * Leads with whatever is most likely to change what you do next: overdue work
 * first, then what is due soon, then a plain count. "3 overdue" earns the open;
 * "Your morning brief" does not.
 */
function previewFor(input: DigestInput): string {
  const { summary } = input;

  if (input.kind !== "daily") {
    const hours = summary.hoursThisWeek;
    return hours
      ? `${formatMinutes(hours.combined)} logged · ${summary.completedThisWeek} completed`
      : `${summary.completedThisWeek} completed`;
  }

  if (summary.overdue > 0) {
    return `${summary.overdue} overdue · ${summary.dueSoon} due soon`;
  }
  if (summary.dueSoon > 0) {
    return `${summary.dueSoon} due soon · nothing overdue`;
  }
  return `${summary.openTasks} open · nothing overdue`;
}

/* ── Text ─────────────────────────────────────────────────────────────── */

function renderText(input: DigestInput): string {
  const lines: string[] = [];
  const { summary } = input;

  lines.push(subjectFor(input));
  lines.push("=".repeat(subjectFor(input).length));
  lines.push("");

  lines.push("SUMMARY");
  lines.push(`  Open tasks        ${summary.openTasks}`);
  lines.push(`  Overdue           ${summary.overdue}`);
  lines.push(`  Due soon          ${summary.dueSoon}`);
  lines.push(`  Untriaged         ${summary.untriaged}`);
  lines.push(`  Completed (week)  ${summary.completedThisWeek}`);
  lines.push(
    `  Hours this week   ${
      summary.hoursThisWeek
        ? formatMinutes(summary.hoursThisWeek.combined)
        : "— not recorded"
    }`,
  );
  // Never a confident zero for something the system cannot see.
  lines.push(
    `  Critical unread   ${
      summary.criticalUnread === null
        ? "— no mail account connected"
        : summary.criticalUnread
    }`,
  );
  lines.push("");

  if (summary.topPriorities.length > 0) {
    lines.push("TOP PRIORITIES");
    for (const task of summary.topPriorities) {
      lines.push(`  · ${taskLine(task, input.timeZone)}`);
    }
    lines.push("");
  }

  if (input.twoDay?.length) {
    lines.push("THE NEXT TWO DAYS");
    for (const slot of input.twoDay) {
      lines.push(`  ${slot.label}`);

      if (slot.events.length === 0 && slot.tasks.length === 0) {
        lines.push("    Nothing scheduled.");
      }

      for (const event of slot.events) {
        lines.push(
          `    ${timeOf(event.startsAt, input.timeZone)}  ${event.title}`,
        );
      }
      for (const task of slot.tasks) {
        lines.push(`    due    ${task.title}`);
      }
      lines.push("");
    }
  }

  if (input.splits?.length) {
    lines.push("WHERE THE TIME WENT");
    for (const split of input.splits) {
      if (split.openTasks === 0 && split.completed === 0 && !split.minutes) {
        continue;
      }
      lines.push(
        `  ${split.name.padEnd(24)} ${String(split.share).padStart(5)}%  ` +
          `${split.completed} done, ${split.openTasks} open`,
      );
    }
    lines.push("");
  }

  if (input.groups?.length) {
    for (const group of input.groups) {
      if (group.tasks.length === 0) continue;

      lines.push(group.label.toUpperCase());
      for (const task of group.tasks) {
        lines.push(`  · ${taskLine(task, input.timeZone)}`);
      }
      lines.push("");
    }
  }

  if (input.baseUrl) {
    lines.push(`Open the dashboard: ${input.baseUrl}/dashboard`);
  }

  return lines.join("\n").trimEnd();
}

function taskLine(task: Task, timeZone: string): string {
  const parts = [task.title];
  if (task.priority) parts.push(`[${task.priority}]`);
  if (task.dueAt) parts.push(`due ${dateOf(task.dueAt, timeZone)}`);
  return parts.join("  ");
}

/* ── HTML ─────────────────────────────────────────────────────────────── */

/**
 * Colours, inlined.
 *
 * The design tokens live in CSS custom properties, which email clients do not
 * support — so these are the same values, hard-coded, and the light palette
 * only. An email that respects `prefers-color-scheme` is a nice idea that
 * three clients implement correctly.
 */
const INK = "#1C1B19";
const MUTED = "#5C5850";
const LINE = "#E3E0D9";
const PRIMARY = "#1E4D3B";
const DANGER = "#A32D2D";

function renderHtml(input: DigestInput, subject: string): string {
  const { summary } = input;

  const rows: string[] = [];

  rows.push(
    statRow("Open tasks", String(summary.openTasks)),
    statRow(
      "Overdue",
      String(summary.overdue),
      summary.overdue > 0 ? DANGER : undefined,
    ),
    statRow("Due soon", String(summary.dueSoon)),
    statRow("Untriaged", String(summary.untriaged)),
    statRow("Completed this week", String(summary.completedThisWeek)),
    statRow(
      "Hours this week",
      summary.hoursThisWeek
        ? formatMinutes(summary.hoursThisWeek.combined)
        : "—",
      undefined,
      summary.hoursThisWeek ? undefined : "not recorded",
    ),
    statRow(
      "Critical unread",
      summary.criticalUnread === null ? "—" : String(summary.criticalUnread),
      undefined,
      summary.criticalUnread === null ? "no mail account connected" : undefined,
    ),
  );

  const sections: string[] = [];

  if (summary.topPriorities.length > 0) {
    sections.push(
      section(
        "Top priorities",
        `<ul style="margin:0;padding-left:18px;color:${INK};font-size:14px;line-height:1.6">
${summary.topPriorities
  .map((task) => `<li>${escapeHtml(taskLine(task, input.timeZone))}</li>`)
  .join("\n")}
</ul>`,
      ),
    );
  }

  if (input.twoDay?.length) {
    sections.push(
      section(
        "The next two days",
        input.twoDay
          .map((slot) => {
            const items = [
              ...slot.events.map(
                (event) =>
                  `<li><strong>${escapeHtml(
                    timeOf(event.startsAt, input.timeZone),
                  )}</strong> ${escapeHtml(event.title)}</li>`,
              ),
              ...slot.tasks.map(
                (task) =>
                  `<li><span style="color:${MUTED}">due</span> ${escapeHtml(
                    task.title,
                  )}</li>`,
              ),
            ];

            return `<p style="margin:12px 0 4px;font-weight:600;color:${INK};font-size:14px">${escapeHtml(
              slot.label,
            )}</p>
${
  items.length === 0
    ? `<p style="margin:0;color:${MUTED};font-size:14px">Nothing scheduled.</p>`
    : `<ul style="margin:0;padding-left:18px;color:${INK};font-size:14px;line-height:1.6">${items.join(
        "",
      )}</ul>`
}`;
          })
          .join("\n"),
      ),
    );
  }

  if (input.splits?.length) {
    const shown = input.splits.filter(
      (split) => split.openTasks > 0 || split.completed > 0 || split.minutes,
    );

    if (shown.length > 0) {
      sections.push(
        section(
          "Where the time went",
          `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
${shown
  .map(
    (split) => `<tr>
  <td style="padding:4px 0;color:${INK}">${escapeHtml(split.name)}</td>
  <td style="padding:4px 0;color:${MUTED};text-align:right">${split.share}%</td>
  <td style="padding:4px 0 4px 12px;color:${MUTED};text-align:right">${split.completed} done</td>
</tr>`,
  )
  .join("\n")}
</table>`,
        ),
      );
    }
  }

  for (const group of input.groups ?? []) {
    if (group.tasks.length === 0) continue;

    sections.push(
      section(
        group.label,
        `<ul style="margin:0;padding-left:18px;color:${INK};font-size:14px;line-height:1.6">
${group.tasks
  .map((task) => `<li>${escapeHtml(taskLine(task, input.timeZone))}</li>`)
  .join("\n")}
</ul>`,
      ),
    );
  }

  // A table-based shell, 600px wide, because that is what works everywhere.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FAF9F7">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#FAF9F7">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px">
<tr><td style="padding:24px">

<h1 style="margin:0 0 4px;font:600 18px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">${escapeHtml(
    subject,
  )}</h1>
<p style="margin:0 0 20px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED}">${escapeHtml(
    previewFor(input),
  )}</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif">
${rows.join("\n")}
</table>

${sections.join("\n")}

${
  input.baseUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(
        input.baseUrl,
      )}/dashboard" style="display:inline-block;padding:10px 16px;background:${PRIMARY};color:#FFFFFF;text-decoration:none;border-radius:6px;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif">Open the dashboard</a></p>`
    : ""
}

</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function statRow(
  label: string,
  value: string,
  colour?: string,
  note?: string,
): string {
  return `<tr>
  <td style="padding:6px 0;border-bottom:1px solid ${LINE};color:${MUTED}">${escapeHtml(
    label,
  )}${note ? ` <span style="color:${MUTED};font-size:12px">(${escapeHtml(note)})</span>` : ""}</td>
  <td style="padding:6px 0;border-bottom:1px solid ${LINE};text-align:right;font-weight:600;color:${
    colour ?? INK
  }">${escapeHtml(value)}</td>
</tr>`;
}

function section(heading: string, body: string): string {
  return `<div style="margin-top:24px">
<h2 style="margin:0 0 8px;font:600 15px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">${escapeHtml(
    heading,
  )}</h2>
${body}
</div>`;
}

/**
 * Escaping.
 *
 * Task titles and meeting names are owner-authored, but they routinely contain
 * `&` and `<`, and a digest is the one place this application emits markup that
 * something else parses. Escaping everything is cheaper than remembering which
 * fields are safe.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Formatting ───────────────────────────────────────────────────────── */

function timeOf(iso: string, timeZone: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
}

function dateOf(iso: string, timeZone: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(new Date(at));
}
