/**
 * Чистое вычисление цветов приложения из Telegram `themeParams` (без DOM).
 *
 * Раскладка повторяет нативные экраны Telegram: фон страницы — secondary_bg,
 * карточки (секции) — section_bg ?? bg. Заливку кнопок/чипов (`--secondary`),
 * дорожки колец и скелетоны (`--muted`) нельзя брать из secondary_bg: внутри
 * карточки они сливаются с ней. Поэтому они выводятся из цвета карточки со
 * сдвигом к text_color, а рамки — смешением карточки с hint_color.
 */

export interface ThemeParamsInput {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

/** Все значения — "#rrggbb" или undefined (тогда остаётся значение из index.css). */
export interface ThemeColors {
  background?: string;
  foreground?: string;
  card?: string;
  secondary?: string;
  muted?: string;
  mutedForeground?: string;
  border?: string;
  primary?: string;
  primaryForeground?: string;
  destructive?: string;
}

/** Доля text_color в заливке --secondary/--muted. */
const FILL_MIX = 0.08;
/** Доля hint_color в рамках. */
const BORDER_MIX = 0.3;

type Rgb = [number, number, number];

function parseHex(hex: string | undefined): Rgb | null {
  if (!hex) return null;
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Нормализует цвет в "#rrggbb" или возвращает undefined, если он не разбирается. */
export function normalizeHex(hex: string | undefined): string | undefined {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : undefined;
}

/** Линейное смешение в sRGB: weight = доля цвета `b`. */
export function mixHex(a: string, b: string, weight: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) throw new Error(`mixHex: bad color ${a} / ${b}`);
  return toHex([
    ca[0] + (cb[0] - ca[0]) * weight,
    ca[1] + (cb[1] - ca[1]) * weight,
    ca[2] + (cb[2] - ca[2]) * weight,
  ]);
}

function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`relativeLuminance: bad color ${hex}`);
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст по WCAG 2.x: 1 (одинаковые) … 21 (чёрный/белый). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function computeThemeColors(tp: ThemeParamsInput): ThemeColors {
  const bg = normalizeHex(tp.bg_color);
  const secondaryBg = normalizeHex(tp.secondary_bg_color);
  const sectionBg = normalizeHex(tp.section_bg_color);
  const text = normalizeHex(tp.text_color);
  const hint = normalizeHex(tp.hint_color) ?? normalizeHex(tp.subtitle_text_color);

  const background = secondaryBg ?? bg;
  const card = sectionBg ?? bg;

  // Если text_color нет — сдвигаем к контрастному полюсу относительно карточки.
  const ink = text ?? (card && relativeLuminance(card) > 0.4 ? "#000000" : "#ffffff");
  const fill = card ? mixHex(card, ink, FILL_MIX) : undefined;
  const border = card ? mixHex(card, hint ?? ink, hint ? BORDER_MIX : FILL_MIX * 2) : undefined;

  return {
    background,
    foreground: text,
    card,
    secondary: fill,
    muted: fill,
    mutedForeground: hint,
    border,
    primary: normalizeHex(tp.button_color),
    primaryForeground: normalizeHex(tp.button_text_color),
    destructive: normalizeHex(tp.destructive_text_color),
  };
}
