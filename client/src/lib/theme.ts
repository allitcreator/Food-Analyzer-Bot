/**
 * Map Telegram `themeParams` onto the app's Tailwind CSS variables so the Mini
 * App looks native in both light and dark Telegram themes. Falls back to the
 * dark defaults defined in index.css when running outside Telegram.
 *
 * Tailwind expects HSL *triples* (e.g. "222 47% 11%") because the config wraps
 * them in `hsl(var(--x) / <alpha>)`, so we convert Telegram's hex colors here.
 */
import { tg, type TelegramThemeParams } from "./telegram";
import { computeThemeColors } from "./theme-colors";

/** "#rrggbb" → "H S% L%" triple, or null if unparseable. */
function hexToHslTriple(hex: string): string | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

let themeListenerBound = false;

function applyOnce() {
  const wa = tg();
  const root = document.documentElement;
  const scheme = wa?.colorScheme ?? "dark";
  root.classList.toggle("dark", scheme === "dark");

  const tp: TelegramThemeParams | undefined = wa?.themeParams;
  if (!tp) return;

  const set = (name: string, hex?: string) => {
    if (!hex) return;
    const triple = hexToHslTriple(hex);
    if (triple) root.style.setProperty(name, triple);
  };

  // Раскладка цветов — в чистой computeThemeColors (покрыта тестом).
  const c = computeThemeColors(tp);
  set("--background", c.background);
  set("--foreground", c.foreground);
  set("--card", c.card);
  set("--card-foreground", c.foreground);
  set("--popover", c.card);
  set("--popover-foreground", c.foreground);
  set("--secondary", c.secondary);
  set("--secondary-foreground", c.foreground);
  set("--muted", c.muted);
  set("--muted-foreground", c.mutedForeground);
  set("--border", c.border);
  set("--card-border", c.border);
  set("--popover-border", c.border);
  set("--input", c.border);
  set("--primary", c.primary);
  set("--primary-foreground", c.primaryForeground);
  set("--accent", c.primary);
  set("--accent-foreground", c.primaryForeground);
  set("--ring", c.primary);
  set("--destructive", c.destructive);

  // Шапка и фон WebView — в цвет страницы, иначе на iOS видна полоса другого тона.
  const pageColor = c.background ?? "#000000";
  try {
    wa?.setHeaderColor?.(pageColor);
    wa?.setBackgroundColor?.(pageColor);
  } catch {
    /* unsupported on older clients */
  }
}

/** Apply the Telegram theme now and re-apply whenever the user switches it. */
export function applyTelegramTheme() {
  applyOnce();
  const wa = tg();
  if (wa && !themeListenerBound) {
    themeListenerBound = true;
    wa.onEvent("themeChanged", applyOnce);
  }
}
