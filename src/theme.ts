/**
 * Theme detection and palette helpers for the monitor UI.
 *
 * Pure module: no side effects, no TUI access. Consumed by `TaskDetailDrawer`
 * and any future TUI components that need to follow the terminal's apparent
 * background. Detection is intentionally conservative — when we cannot tell, we
 * assume dark because the existing monitor ships a dark-friendly palette.
 */
export type Theme = "dark" | "light";

/** Foreground ANSI indices that strongly suggest the terminal is on a light
 *  background. Kept short on purpose — false positives are worse than false
 *  negatives for this feature. */
const LIGHT_FOREGROUND_INDICES = new Set<number>([
  7, // standard white
  15, // bright white
  231, // xterm-256 white
  230, // xterm-256 off-white
  252, // xterm-256 light gray
  253, // xterm-256 lighter gray
  254, // xterm-256 near-white
  255, // xterm-256 white in some schemes
]);

/** Parse `COLORFGBG` (format: `<fg>;<bg>` or `<fg>;<bg>;extra`) and return the
 *  numeric foreground index, or `null` when the value is malformed. We require
 *  at least one `;` so a bare `"15"` is rejected — terminals that emit only a
 *  single index are ambiguous and we want dark. */
function parseColorFgBg(raw: string | undefined): number | null {
  if (!raw || !raw.includes(";")) return null;
  const first = raw.split(";")[0]?.trim();
  if (!first) return null;
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

function lightTermHint(term: string | undefined): boolean {
  if (!term) return false;
  return /-light$/i.test(term);
}

/**
 * Detect the terminal's apparent theme. Order of preference:
 *   1. `COLORFGBG` foreground index in `LIGHT_FOREGROUND_INDICES` -> light.
 *   2. `TERM` ending in `-light` (some terminals export this) -> light.
 *   3. Anything else (missing, malformed, conflicting) -> dark.
 */
export function detectTheme(): Theme {
  const fg = parseColorFgBg(process.env.COLORFGBG);
  if (fg !== null && LIGHT_FOREGROUND_INDICES.has(fg)) return "light";
  if (lightTermHint(process.env.TERM)) return "light";
  return "dark";
}

/** Palette returned to consumers. Mirrors the inline `COLORS` map used in
 *  `src/index.ts` so callers can swap one accent shade for another without
 *  reaching into another module's internals. */
export interface ThemePalette {
  foreground: string;
  dim: string;
  accent: string;
  ok: string;
  warn: string;
  err: string;
  /** Background marker (e.g. "bgGreen") for "LIVE" badges. */
  liveBadge: string;
  selection: string;
}

export function themeColors(theme: Theme): ThemePalette {
  if (theme === "light") {
    return {
      foreground: "white",
      dim: "gray",
      accent: "blue",
      ok: "green",
      warn: "yellow",
      err: "red",
      liveBadge: "bgGreen",
      selection: "blue",
    };
  }
  return {
    foreground: "white",
    dim: "dim",
    accent: "cyan",
    ok: "green",
    warn: "yellow",
    err: "red",
    liveBadge: "bgGreen",
    selection: "cyan",
  };
}