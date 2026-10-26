/**
 * Тема Mini App. Палитра своя (index.css: :root — светлая, .dark — тёмная),
 * от Telegram берём только colorScheme и следим за themeChanged. Шапку и фон
 * WebView красим в наш --background, иначе на iOS видна полоса другого тона.
 * Вне Telegram схема — по prefers-color-scheme.
 */
import { tg } from "./telegram";

/** Hex-значения --background из index.css: Telegram принимает только #rrggbb. */
const PAGE_COLOR = { light: "#fdf6ee", dark: "#1b1613" } as const;

let themeListenerBound = false;

function systemScheme(): "light" | "dark" {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyOnce() {
  const wa = tg();
  const scheme = wa?.colorScheme ?? systemScheme();
  document.documentElement.classList.toggle("dark", scheme === "dark");

  const pageColor = PAGE_COLOR[scheme];
  // Каждый вызов отдельно: на старых клиентах части методов нет.
  for (const set of [wa?.setHeaderColor, wa?.setBackgroundColor, wa?.setBottomBarColor]) {
    try {
      set?.call(wa, pageColor);
    } catch {
      /* unsupported on older clients */
    }
  }
}

/** Apply the scheme now and re-apply whenever the user switches it in Telegram. */
export function applyTelegramTheme() {
  applyOnce();
  const wa = tg();
  if (wa && !themeListenerBound) {
    themeListenerBound = true;
    wa.onEvent("themeChanged", applyOnce);
  }
}
