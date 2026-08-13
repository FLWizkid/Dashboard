import type { Transition, Variants } from "framer-motion";

/**
 * Motion tokens.
 *
 * These mirror the `--motion-*` / `--ease-*` custom properties in
 * `globals.css` so a CSS transition and a Framer Motion animation on the same
 * element move at the same speed. Keep the two in sync.
 *
 * Reduced motion is handled in two places and both are required:
 *   1. `globals.css` collapses every CSS duration under the media query.
 *   2. Components call `useReducedMotion()` and pass the result to the helpers
 *      below, which strip travel and shorten the transition.
 */
export const DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.36,
  celebrate: 0.62,
} as const;

type CubicBezier = [number, number, number, number];

export const EASE: Record<"standard" | "out" | "inOut", CubicBezier> = {
  standard: [0.2, 0, 0, 1],
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
};

/** A calm default transition. */
export const transition: Transition = {
  duration: DURATION.base,
  ease: EASE.out,
};

/** Same shape, but instant — for `prefers-reduced-motion: reduce`. */
export const instant: Transition = { duration: 0 };

export function pick(reduced: boolean | null): Transition {
  return reduced ? instant : transition;
}

/**
 * Gentle reveal used by cards, rows and panels. `distance` is dropped entirely
 * under reduced motion so nothing travels — the element just fades in.
 */
export function riseIn(reduced: boolean | null, distance = 6): Variants {
  return {
    hidden: { opacity: 0, y: reduced ? 0 : distance },
    visible: {
      opacity: 1,
      y: 0,
      transition: pick(reduced),
    },
    exit: {
      opacity: 0,
      y: reduced ? 0 : -distance,
      transition: { duration: reduced ? 0 : DURATION.fast },
    },
  };
}

/**
 * Staggered list container. Children opt in with `riseIn`.
 * Stagger is disabled under reduced motion so a long list doesn't crawl.
 */
export function staggerList(reduced: boolean | null, step = 0.03): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: reduced ? 0 : step },
    },
  };
}

/**
 * The task-complete moment: the row settles, dims, and collapses out.
 * Deliberately short — satisfying, never in the way of the next capture.
 */
export function completeRow(reduced: boolean | null): Variants {
  return {
    idle: { opacity: 1, scale: 1, height: "auto" },
    completing: {
      opacity: reduced ? 1 : 0.55,
      scale: reduced ? 1 : 0.985,
      transition: { duration: reduced ? 0 : DURATION.fast },
    },
    removed: {
      opacity: 0,
      height: 0,
      marginTop: 0,
      marginBottom: 0,
      transition: { duration: reduced ? 0 : DURATION.slow, ease: EASE.out },
    },
  };
}
