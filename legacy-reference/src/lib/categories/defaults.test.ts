import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_SLUGS } from "./defaults";

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260805000001_tasks_core.sql",
  ),
  "utf8",
);

describe("the CIO activity taxonomy", () => {
  it("has the eight defaults from the product spec", () => {
    expect(DEFAULT_CATEGORY_SLUGS).toEqual([
      "strategic",
      "operational",
      "people-team",
      "stakeholder-board",
      "vendor-budget",
      "security-risk-compliance",
      "innovation-rd",
      "admin-inbox",
    ]);
  });

  it("numbers positions 1..8 in order", () => {
    expect(DEFAULT_CATEGORIES.map((category) => category.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("uses slugs the database's check constraint accepts", () => {
    const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.slug).toMatch(slugPattern);
    }
  });

  it("has no duplicate slugs or aliases", () => {
    const tokens = DEFAULT_CATEGORIES.flatMap((category) => [
      category.slug,
      ...category.aliases,
    ]);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

/**
 * The database is what actually seeds the taxonomy; this TypeScript copy only
 * exists so the parser can resolve `#strategic` without a round-trip. These
 * assertions are what stop the two drifting apart.
 */
describe("stays in step with the migration that seeds it", () => {
  it("seeds every slug the TypeScript copy knows about", () => {
    for (const slug of DEFAULT_CATEGORY_SLUGS) {
      expect(MIGRATION).toContain(`'${slug}'`);
    }
  });

  it("seeds the same display names", () => {
    for (const category of DEFAULT_CATEGORIES) {
      // Single quotes are doubled in SQL string literals.
      expect(MIGRATION).toContain(category.name.replace(/'/g, "''"));
    }
  });

  it("seeds exactly eight rows", () => {
    const seedBody = MIGRATION.slice(
      MIGRATION.indexOf("seed_default_activity_categories"),
    );
    const rows = seedBody.match(/\(target_user, '/g) ?? [];
    expect(rows).toHaveLength(8);
  });
});
