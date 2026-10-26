/**
 * Чистые метрики для scripts/eval-models.ts. Без сети, файлов и логов.
 * Тесты — tests/eval-metrics.test.ts.
 */

export type Range = [number, number];

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const STOP = new Set(["с", "и", "на", "из", "без", "в", "со", "по", "для", "под"]);

/** Грубый стемминг для русских форм: «гречка/гречку» → «греч». */
function stem(word: string): string {
  if (word.length <= 4) return word.slice(0, 3);
  return word.slice(0, word.length - 2);
}

function tokens(s: string): string[] {
  return normalizeName(s)
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

function trigramDice(a: string, b: string): number {
  const grams = (s: string) => {
    const padded = `  ${s} `;
    const out = new Map<string, number>();
    for (let i = 0; i < padded.length - 2; i++) {
      const g = padded.slice(i, i + 3);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  let total = 0;
  ga.forEach((n, g) => { inter += Math.min(n, gb.get(g) ?? 0); total += n; });
  gb.forEach((n) => { total += n; });
  return total === 0 ? 0 : (2 * inter) / total;
}

/**
 * Похожесть названий 0..1: максимум из доли совпавших слов (с грубым
 * стеммингом) и Dice по триграммам символов.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  let overlap = 0;
  if (ta.length && tb.length) {
    const hitA = ta.filter((x) => tb.some((y) => tokenMatches(x, y))).length;
    const hitB = tb.filter((y) => ta.some((x) => tokenMatches(x, y))).length;
    overlap = (hitA + hitB) / (ta.length + tb.length);
  }
  return Math.max(overlap, trigramDice(na, nb));
}

export interface NamedExpectation {
  name: string;
  aliases?: string[];
}

export interface ItemMatch {
  pairs: { expected: number; actual: number; similarity: number }[];
  unmatchedExpected: number[];
  unmatchedActual: number[];
}

/**
 * Жадное сопоставление эталонных позиций с ответом модели: сначала самые
 * похожие пары, каждая позиция участвует не больше одного раза.
 */
export function matchItems(expected: NamedExpectation[], actualNames: string[], threshold = 0.5): ItemMatch {
  const candidates: { expected: number; actual: number; similarity: number }[] = [];
  expected.forEach((e, i) => {
    const names = [e.name, ...(e.aliases ?? [])];
    actualNames.forEach((a, j) => {
      const sim = Math.max(...names.map((n) => nameSimilarity(n, a)));
      if (sim >= threshold) candidates.push({ expected: i, actual: j, similarity: sim });
    });
  });
  candidates.sort((x, y) => y.similarity - x.similarity || x.expected - y.expected || x.actual - y.actual);
  const usedE = new Set<number>();
  const usedA = new Set<number>();
  const pairs: ItemMatch["pairs"] = [];
  for (const c of candidates) {
    if (usedE.has(c.expected) || usedA.has(c.actual)) continue;
    usedE.add(c.expected);
    usedA.add(c.actual);
    pairs.push(c);
  }
  pairs.sort((x, y) => x.expected - y.expected);
  return {
    pairs,
    unmatchedExpected: expected.map((_, i) => i).filter((i) => !usedE.has(i)),
    unmatchedActual: actualNames.map((_, j) => j).filter((j) => !usedA.has(j)),
  };
}

/** Пустой ответ при пустом эталоне — идеально; пустой ответ — precision 1, recall 0. */
export function precisionRecall(matched: number, expectedCount: number, actualCount: number) {
  return {
    precision: actualCount === 0 ? 1 : matched / actualCount,
    recall: expectedCount === 0 ? 1 : matched / expectedCount,
  };
}

export function inRange(value: number, range: Range): boolean {
  return Number.isFinite(value) && value >= range[0] && value <= range[1];
}

export function midpoint(range: Range): number {
  return (range[0] + range[1]) / 2;
}

/** |факт − середина| / середина. Для нулевого эталона (вода) процент не определён — null. */
export function absPctError(value: number, range: Range): number | null {
  const mid = midpoint(range);
  if (mid === 0 || !Number.isFinite(value)) return null;
  return Math.round((Math.abs(value - mid) / mid) * 1e9) / 1e9;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Перцентиль с линейной интерполяцией между соседними значениями. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Character error rate по нормализованному тексту (регистр, ё, пунктуация не считаются). */
export function cer(reference: string, hypothesis: string): number {
  const ref = Array.from(normalizeName(reference));
  const hyp = Array.from(normalizeName(hypothesis));
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / ref.length;
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const line = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;
  return [line(headers), `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

export interface ExpectedFoodItem extends NamedExpectation {
  weight?: Range;
  calories: Range;
  protein: Range;
  fat: Range;
  carbs: Range;
  hydrating?: boolean;
  mealType?: string;
}

export interface ActualFoodItem {
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  hydrating?: boolean;
  mealType?: string;
}

export interface FoodItemsScore {
  matched: number;
  expectedCount: number;
  actualCount: number;
  /** APE калорий по сопоставленным позициям (эталоны меньше 20 ккал не считаются). */
  kcalApe: number[];
  kcalInRange: boolean[];
  macroAbsErr: { protein: number[]; fat: number[]; carbs: number[] };
  macroInRange: boolean[];
  hydratingHits: boolean[];
  mealTypeHits: boolean[];
  /** APE суммы калорий кейса: не зависит от того, как модель разбила блюда. */
  totalKcalApe: number | null;
}

const MIN_KCAL_FOR_APE = 20;

export function scoreFoodItems(expected: ExpectedFoodItem[], actual: ActualFoodItem[]): FoodItemsScore {
  const m = matchItems(expected, actual.map((a) => a.foodName ?? ""));
  const score: FoodItemsScore = {
    matched: m.pairs.length,
    expectedCount: expected.length,
    actualCount: actual.length,
    kcalApe: [],
    kcalInRange: [],
    macroAbsErr: { protein: [], fat: [], carbs: [] },
    macroInRange: [],
    hydratingHits: [],
    mealTypeHits: [],
    totalKcalApe: null,
  };
  for (const { expected: i, actual: j } of m.pairs) {
    const e = expected[i];
    const a = actual[j];
    // Для почти нулевых эталонов (вода, чай) процент бессмыслен: 3 ккал вместо
    // 2,5 — это +20%. Их точность видна по попаданию в диапазон.
    const ape = midpoint(e.calories) >= MIN_KCAL_FOR_APE ? absPctError(Number(a.calories), e.calories) : null;
    if (ape !== null) score.kcalApe.push(ape);
    score.kcalInRange.push(inRange(Number(a.calories), e.calories));
    for (const k of ["protein", "fat", "carbs"] as const) {
      const v = Number(a[k]);
      score.macroAbsErr[k].push(Number.isFinite(v) ? Math.abs(v - midpoint(e[k])) : midpoint(e[k]));
      score.macroInRange.push(inRange(v, e[k]));
    }
    score.hydratingHits.push((a.hydrating === true) === (e.hydrating === true));
    if (e.mealType) score.mealTypeHits.push(a.mealType === e.mealType);
  }
  const expectedTotal = expected.reduce((s, e) => s + midpoint(e.calories), 0);
  const actualTotal = actual.reduce((s, a) => s + (Number(a.calories) || 0), 0);
  score.totalKcalApe = expectedTotal >= MIN_KCAL_FOR_APE ? Math.abs(actualTotal - expectedTotal) / expectedTotal : null;
  return score;
}
