// Apply karo — theme resolution.
//
// The stored preference is one of "system" | "light" | "dark". Everything that
// paints reads the *resolved* value off `<html data-theme>`, so the CSS only
// ever has to know about two palettes rather than three states.
//
// styles.css also carries a `prefers-color-scheme` block for `:root:not([data-theme])`,
// which covers the frame or two before this module runs — without it a dark-mode
// user gets a white flash on every popup open.

export const THEMES = ["system", "light", "dark"];

const mql = () =>
  (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

/** "light" | "dark" — what a preference actually means right now. */
export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return mql()?.matches ? "dark" : "light";
}

/**
 * Paint a preference onto a document (or a shadow host, for the on-page panel).
 * Returns the resolved theme so callers can label a toggle without re-deriving it.
 */
export function applyTheme(pref, root) {
  const resolved = resolveTheme(pref);
  const target = root || document.documentElement;
  target.dataset.theme = resolved;
  if (target.style) target.style.colorScheme = resolved;
  return resolved;
}

/**
 * Keep `pref` painted, following the OS while it is "system".
 * Returns a function that stops watching.
 */
export function watchTheme(getPref, root, onChange) {
  const m = mql();
  if (!m) return () => {};
  const handler = () => {
    if (getPref() !== "system") return;
    onChange?.(applyTheme("system", root));
  };
  m.addEventListener?.("change", handler);
  return () => m.removeEventListener?.("change", handler);
}
