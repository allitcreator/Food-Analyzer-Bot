/**
 * Map Telegram `themeParams` onto the app's Tailwind CSS variables so the Mini
 * App looks native in both light and dark Telegram themes. Falls back to the
 * dark defaults defined in index.css when running outside Telegram.
 *
 * Tailwind expects HSL *triples* (e.g. "222 47% 11%") because the config wraps
 * them in `hsl(var(--x) / <alpha>)`, so we convert Telegram's hex colors here.
 */
import { tg, type TelegramThemeParams } from "./telegram";

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

  set("--background", tp.bg_color);
  set("--foreground", tp.text_color);
  set("--card", tp.secondary_bg_color ?? tp.bg_color);
  set("--card-foreground", tp.text_color);
  set("--popover", tp.secondary_bg_color ?? tp.bg_color);
  set("--popover-foreground", tp.text_color);
  set("--secondary", tp.secondary_bg_color);
  set("--secondary-foreground", tp.text_color);
  set("--muted", tp.secondary_bg_color);
  set("--muted-foreground", tp.hint_color ?? tp.subtitle_text_color);
  set("--primary", tp.button_color);
  set("--primary-foreground", tp.button_text_color);
  set("--accent", tp.button_color);
  set("--accent-foreground", tp.button_text_color);
  set("--ring", tp.button_color);
  set("--destructive", tp.destructive_text_color);

  try {
    wa?.setHeaderColor?.(tp.bg_color ?? "#000000");
    wa?.setBackgroundColor?.(tp.bg_color ?? "#000000");
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
