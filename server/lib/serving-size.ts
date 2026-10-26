/**
 * Размер порции из Open Food Facts (`serving_size`, свободная строка) → граммы
 * или миллилитры порции. Примеры из OFF: «250 ml», «0,5 l», «1.5 L»,
 * «30 g (2 pieces)», «1 portion (40 g)», «8 fl oz (240 ml)».
 *
 * Берём первое число с известной единицей массы/объёма (дробь с точкой или
 * запятой). Голое число без единицы считаем граммами (так было и раньше).
 * Унции и штуки не переводим. Нераспознанное или ≤0 → DEFAULT_SERVING.
 */

export const DEFAULT_SERVING = 100;

const UNIT_FACTORS: Record<string, number> = {
  kg: 1000, "кг": 1000,
  g: 1, gr: 1, "г": 1, "гр": 1,
  l: 1000, "л": 1000,
  dl: 100, cl: 10,
  ml: 1, "мл": 1,
};

// Длинные варианты раньше коротких, чтобы «ml» не разобрался как «m»+«l».
const WITH_UNIT = /(\d+(?:[.,]\d+)?)\s*(kg|кг|ml|мл|cl|dl|gr|гр|g|г|l|л)(?![a-zа-яё])/i;
const BARE_NUMBER = /^\s*(\d+(?:[.,]\d+)?)\s*$/;

function toNumber(s: string): number {
  return Number(s.replace(",", "."));
}

export function parseServingSize(raw: string | null | undefined): number {
  if (!raw) return DEFAULT_SERVING;
  let value: number | null = null;
  const m = raw.match(WITH_UNIT);
  if (m) {
    value = toNumber(m[1]) * UNIT_FACTORS[m[2].toLowerCase()];
  } else {
    const bare = raw.match(BARE_NUMBER);
    if (bare) value = toNumber(bare[1]);
  }
  if (value === null || !Number.isFinite(value)) return DEFAULT_SERVING;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : DEFAULT_SERVING;
}
