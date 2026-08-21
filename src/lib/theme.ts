/**
 * Which of the two palettes is on screen.
 *
 * Three settings, not two. "Dark" and "Light" are choices; `system` is the
 * absence of one, and collapsing it into a boolean is how an app ends up
 * ignoring someone who switches their laptop to dark at sunset.
 */

export const THEME_SETTINGS = ["system", "light", "dark"] as const;
export type ThemeSetting = (typeof THEME_SETTINGS)[number];

export const THEME_SETTING_LABELS: Record<ThemeSetting, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export const THEME_STORAGE_KEY = "dashboard.theme";

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return (
    typeof value === "string" &&
    (THEME_SETTINGS as readonly string[]).includes(value)
  );
}

/**
 * The script that runs before first paint.
 *
 * It has to be inline and synchronous. Anything else — a `useEffect`, a
 * deferred bundle, a server guess at the preference — paints the wrong theme
 * first and corrects it a frame later, which is the white flash this product
 * specifically does not want. It is small enough to read in one go, which is
 * the other requirement for something that runs with a CSP nonce.
 *
 * `system` resolves to **dark** unless the operating system asks for light.
 * That is the deliberate part: a machine expressing no preference gets the
 * palette this product is designed around, rather than the browser's default
 * of light. Someone who has actually chosen light still gets light.
 */
/**
 * Authorised by hash, not by nonce.
 *
 * The obvious way to let this past the CSP is to stamp it with the
 * per-request nonce the middleware already mints, which means reading
 * `headers()` in the root layout. That works. It is not what this does, for
 * two reasons.
 *
 * A hash is **narrower**. `'sha256-…'` authorises exactly this content and
 * nothing else, where a nonce authorises whichever script happens to carry
 * the token — so if an injection ever manages to get the nonce onto a script
 * tag, the nonce lets it run and the hash does not.
 *
 * A hash is also **free of the layout's rendering mode**. Reading `headers()`
 * in the root layout makes the root layout dynamic, and the root layout is
 * part of every route. Every route in this application is already dynamic for
 * its own reasons — I briefly believed otherwise and said so here, which was
 * wrong and is corrected — so today that costs nothing. It would cost
 * something the day any page here becomes prerenderable, and a static script
 * has no business being the reason that cannot happen.
 *
 * Hashes compose with `strict-dynamic`, which ignores host allowlists but
 * honours hashes and nonces alike.
 *
 * The digest is written out rather than computed, so that nothing has to run
 * Node's crypto in the edge middleware. `theme.test.ts` recomputes it from
 * the script below and fails if the two have drifted — which is the failure
 * you want, because the alternative is a silent CSP violation that only shows
 * up as the theme flashing on first paint.
 */
export const THEME_BOOT_SCRIPT_HASH =
  "sha256-uVdimGfm4XNp2jHgSHGCzUZDmFYOcMuBcNIAHA7DS9U=";

export const THEME_BOOT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (error) {
    /* Private mode, blocked storage, no matchMedia. The stylesheet's own
       media query is the fallback and it is already correct. */
  }
})();
`.trim();

/** What `setting` actually renders as, given the machine's preference. */
export function resolveTheme(
  setting: ThemeSetting,
  prefersLight: boolean,
): "light" | "dark" {
  if (setting === "light" || setting === "dark") return setting;
  return prefersLight ? "light" : "dark";
}
