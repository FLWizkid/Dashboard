"use client";

import dynamic from "next/dynamic";

/**
 * The category editor, fetched when the page is idle rather than with it.
 *
 * It is a settings screen consulted about once a quarter, and it was sitting
 * in the initial bundle of `/dashboard/tasks` — the heaviest and most-visited
 * route in the product. The performance budget caught it: three heaviest
 * routes came to 1605 kB against a 1600 kB cap.
 *
 * Splitting it is the honest fix rather than raising the ceiling. Nobody
 * lands on Tasks to rename a category, so nobody should wait for the code
 * that does. Same reasoning as the next-two-days card on the dashboard.
 */
const Manager = dynamic(
  () => import("./category-manager").then((m) => m.CategoryManager),
  { loading: () => null },
);

export function CategoryManagerLazy() {
  return <Manager />;
}
