/**
 * What moved outside the app since the last brief.
 *
 * This is the reason to connect anything at all. A list of pull requests you
 * linked is filing; **"the PR your task is waiting on merged overnight" is
 * information**, and it is the only thing here that could change what you do
 * this morning.
 *
 * So the brief does not list linked context. It lists linked context that
 * *changed*, and says what changed about it.
 */

import type { LinkedRef } from "@/lib/connectors/model";
import { isSettled } from "@/lib/connectors/model";

export interface ContextChange {
  /** The link, with its reference. */
  link: LinkedRef;
  /**
   * Why it is worth a line in the brief.
   *
   * `settled` outranks `updated` because a merged pull request may mean a
   * task is finished, and that is an action. Ordinary activity is a nudge.
   */
  reason: "settled" | "updated";
}

export interface ContextChangesOptions {
  links: readonly LinkedRef[];
  /** Everything after this instant counts as news. */
  since: Date;
  /** Keep the brief a brief. */
  limit?: number;
}

/**
 * The changes worth reporting, most consequential first.
 *
 * Unconfirmed links are excluded. A suggestion the owner has not agreed to is
 * not yet a relationship, and announcing news about it in a morning email
 * would be the product asserting a link it was explicitly designed not to
 * assert.
 */
export function contextChanges(
  options: ContextChangesOptions,
): ContextChange[] {
  const { links, since, limit = 8 } = options;
  const cutoff = since.getTime();

  const changes: ContextChange[] = [];

  for (const link of links) {
    if (!link.confirmedAt) continue;

    const updatedAt = link.ref.remoteUpdatedAt
      ? Date.parse(link.ref.remoteUpdatedAt)
      : Number.NaN;

    if (!Number.isFinite(updatedAt) || updatedAt <= cutoff) continue;

    changes.push({
      link,
      reason: isSettled(link.ref) ? "settled" : "updated",
    });
  }

  return changes
    .sort((a, b) => {
      // Settled first — a merged pull request may mean a task is done.
      if (a.reason !== b.reason) return a.reason === "settled" ? -1 : 1;

      const left = Date.parse(a.link.ref.remoteUpdatedAt ?? "");
      const right = Date.parse(b.link.ref.remoteUpdatedAt ?? "");
      if (left !== right) return right - left;

      // A total order, so the brief and the screen agree and a re-run does
      // not reshuffle the list.
      return a.link.id.localeCompare(b.link.id);
    })
    .slice(0, limit);
}

/**
 * One line of plain English for a change.
 *
 * Written here rather than in the composer so the email, the text version and
 * the screen cannot describe the same event differently.
 */
export function describeChange(change: ContextChange): string {
  const { ref } = change.link;
  const where = ref.subtitle ? ` (${ref.subtitle})` : "";

  if (change.reason === "settled") {
    const verb =
      ref.state === "merged"
        ? "was merged"
        : ref.state === "archived"
          ? "was archived"
          : "was closed";

    return `${ref.title}${where} ${verb}`;
  }

  return `${ref.title}${where} has activity`;
}
