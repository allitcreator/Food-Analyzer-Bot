/**
 * Typed wrapper around the official Telegram WebApp SDK
 * (loaded via <script src="https://telegram.org/js/telegram-web-app.js">).
 *
 * No npm dependency — we only describe the subset of the API we use and read it
 * off `window.Telegram.WebApp` at runtime, degrading gracefully outside Telegram
 * (e.g. local browser development).
 */
import { useEffect } from "react";

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotificationType = "error" | "success" | "warning";

interface HapticFeedback {
  impactOccurred(style: ImpactStyle): void;
  notificationOccurred(type: NotificationType): void;
  selectionChanged(): void;
}

interface BackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string };
  };
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  version: string;
  ready(): void;
  expand(): void;
  close(): void;
  BackButton: BackButton;
  HapticFeedback: HapticFeedback;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

/** The live WebApp object, or undefined when running outside Telegram. */
export function tg(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

/** Are we actually inside a Telegram client with a signed initData? */
export function isTelegram(): boolean {
  return Boolean(tg()?.initData);
}

/** Call once on boot: mark ready and expand to full height. */
export function initTelegram() {
  const wa = tg();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
  } catch {
    /* older clients */
  }
}

/**
 * Raw initData string for the `Authorization: tma <initData>` header.
 * Falls back to VITE_DEV_INIT_DATA for local development.
 */
export function getInitData(): string {
  const wa = tg();
  if (wa?.initData) return wa.initData;
  return (import.meta.env.VITE_DEV_INIT_DATA as string | undefined) ?? "";
}

// ─── Haptics (all no-ops outside Telegram / on old clients) ──────────────────

export function hapticImpact(style: ImpactStyle = "light") {
  try {
    tg()?.HapticFeedback?.impactOccurred(style);
  } catch {
    /* unsupported */
  }
}

export function hapticNotification(type: NotificationType) {
  try {
    tg()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* unsupported */
  }
}

export function hapticSelection() {
  try {
    tg()?.HapticFeedback?.selectionChanged();
  } catch {
    /* unsupported */
  }
}

/**
 * Show the native Telegram BackButton while a modal / sub-screen is mounted,
 * invoking `onBack` when tapped. No-op outside Telegram.
 */
export function useBackButton(active: boolean, onBack: () => void) {
  useEffect(() => {
    const wa = tg();
    if (!wa || !active) return;
    // BackButton exists only since Bot API 6.1 — guard against old clients.
    const btn = wa.BackButton;
    if (!btn) return;
    try {
      btn.onClick(onBack);
      btn.show();
    } catch {
      return;
    }
    return () => {
      try {
        btn.offClick(onBack);
        btn.hide();
      } catch {
        /* old client */
      }
    };
  }, [active, onBack]);
}
