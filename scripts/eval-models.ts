/**
 * Сравнение моделей на реальных функциях server/openai.ts.
 *
 *   npx tsx scripts/eval-models.ts --task text|photo|voice \
 *     [--models a,b] [--repeat 3] [--limit 10] [--concurrency 4] [--reasoning none|minimal|low]
 *
 * Модель подменяется через config.aiModels (тот же механизм, что AI_MODEL_* в
 * проде), fallback выключается. Ключ — только OPENROUTER_API_KEY из
 * окружения; никуда не печатается и не пишется. В консоль идут только
 * метрики, сырые ответы — в eval/results/<дата>/ (в .gitignore).
 * Подробности — eval/README.md.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, appendFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import {
  cer,
  markdownTable,
  mean,
  percentile,
  precisionRecall,
  scoreFoodItems,
  inRange,
  absPctError,
  type ExpectedFoodItem,
  type FoodItemsScore,
  type Range,
} from "./eval/metrics";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVAL_DIR = path.join(ROOT, "eval");
const PHOTO_MANIFEST = path.join(EVAL_DIR, "photos", "manifest.json");
type Task = "text" | "photo" | "voice";
const TASK_ROLE = { text: "text", photo: "vision", voice: "audio" } as const;

// ---------------------------------------------------------------------------
// Аргументы
// ---------------------------------------------------------------------------
interface Args { task: Task; models: string[]; repeat: number; limit?: number; concurrency: number; reasoning?: string }

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const task = get("task") as Task | undefined;
  if (!task || !["text", "photo", "voice"].includes(task)) {
    throw new Error("Укажите --task text|photo|voice. Пример: npx tsx scripts/eval-models.ts --task text --models openai/gpt-4o-mini,openai/gpt-6-luna --repeat 3");
  }
  const num = (name: string, def?: number) => {
    const v = get(name);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} должен быть целым числом ≥ 1`);
    return n;
  };
  const reasoning = get("reasoning");
  if (reasoning && !["none", "minimal", "low", "medium", "high"].includes(reasoning)) {
    throw new Error("--reasoning: none|minimal|low|medium|high");
  }
  return {
    task,
    models: (get("models") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    repeat: num("repeat", 1)!,
    limit: num("limit"),
    concurrency: num("concurrency", 4)!,
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// Учёт вызовов: usage/стоимость приходят через наблюдатель из openai.ts,
// AsyncLocalStorage раскладывает их по кейсам при параллельном прогоне.
// ---------------------------------------------------------------------------
interface CallUsage { fnName: string; model: string; content: string; promptTokens: number; completionTokens: number; reasoningTokens: number; cost: number | null }
const callStore = new AsyncLocalStorage<CallUsage[]>();

interface Timed<T> { value: T; latencyMs: number; calls: CallUsage[] }
async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const calls: CallUsage[] = [];
  const started = performance.now();
  const value = await callStore.run(calls, fn);
  return { value, latencyMs: performance.now() - started, calls };
}

/** Падение одного кейса не роняет прогон: считаем ошибку, summary всё равно пишется. */
function guard(acc: Acc, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      acc.jobErrors++;
      console.error(`  кейс упал: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`);
    }
  };
}

function isJson(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Накопитель метрик по модели
// ---------------------------------------------------------------------------
class Acc {
  calls = 0;
  failedCalls = 0; // функция не получила ни одного ответа от API
  jsonCalls = 0; // вызовы JSON-функций, получившие ответ
  jsonValid = 0;
  costMissing = 0; // ответы без usage.cost
  jobErrors = 0; // кейсы, упавшие исключением (битый эталон, файл и т.п.)
  latency: number[] = [];
  cost = 0;
  completionTokens = 0;
  reasoningTokens = 0;
  units = 0; // кейсов × повторов
  bool: Record<string, boolean[]> = {};
  num: Record<string, number[]> = {};

  push(kind: string, v: boolean | number | null | undefined) {
    if (v === null || v === undefined) return;
    if (typeof v === "boolean") (this.bool[kind] ??= []).push(v);
    else (this.num[kind] ??= []).push(v);
  }

  call(t: Timed<unknown>, expectJson: boolean) {
    this.calls++;
    this.latency.push(t.latencyMs);
    if (t.calls.length === 0) this.failedCalls++;
    for (const c of t.calls) {
      if (c.cost === null) this.costMissing++;
      else this.cost += c.cost;
      this.completionTokens += c.completionTokens;
      this.reasoningTokens += c.reasoningTokens;
    }
    // Знаменатель — ответившие вызовы: опечатка в id модели — это не плохой JSON.
    if (expectJson && t.calls.length > 0) {
      this.jsonCalls++;
      if (t.calls.every((c) => isJson(c.content))) this.jsonValid++;
    }
  }

  /** answered=false: API не ответил — пустой список не засчитываем как precision 1. */
  items(s: FoodItemsScore, answered: boolean) {
    const pr = precisionRecall(s.matched, s.expectedCount, s.actualCount);
    if (answered) this.push("precision", pr.precision);
    this.push("recall", pr.recall);
    s.kcalApe.forEach((v) => this.push("kcalApe", v));
    s.kcalInRange.forEach((v) => this.push("kcalInRange", v));
    s.macroAbsErr.protein.forEach((v) => this.push("maeP", v));
    s.macroAbsErr.fat.forEach((v) => this.push("maeF", v));
    s.macroAbsErr.carbs.forEach((v) => this.push("maeC", v));
    s.macroInRange.forEach((v) => this.push("macroInRange", v));
    s.hydratingHits.forEach((v) => this.push("hydrating", v));
    s.mealTypeHits.forEach((v) => this.push("mealType", v));
    this.push("totalKcalApe", s.totalKcalApe);
  }

  rate(kind: string): string {
    const a = this.bool[kind];
    return a?.length ? `${((a.filter(Boolean).length / a.length) * 100).toFixed(0)}% (${a.length})` : "—";
  }
  avg(kind: string, digits = 1, pct = false): string {
    const m = mean(this.num[kind] ?? []);
    if (m === null) return "—";
    return pct ? `${(m * 100).toFixed(0)}%` : m.toFixed(digits);
  }
}

function fmtMs(v: number | null) { return v === null ? "—" : `${(v / 1000).toFixed(1)} с`; }

function summaryRows(task: Task, accs: Map<string, Acc>): { headers: string[]; rows: string[][] } {
  const common = (a: Acc) => [
    String(a.jobErrors),
    `${a.calls - a.failedCalls}/${a.calls}`,
    fmtMs(percentile(a.latency, 50)),
    fmtMs(percentile(a.latency, 95)),
    a.costMissing ? `≥ $${a.cost.toFixed(4)} (без cost: ${a.costMissing})` : `$${a.cost.toFixed(4)}`,
    a.units && !a.costMissing ? `$${(a.cost / a.units).toFixed(5)}` : "—",
    a.calls ? (a.reasoningTokens / a.calls).toFixed(0) : "—",
  ];
  const commonHead = ["ошибок кейсов", "ответов", "p50", "p95", "стоимость", "на кейс", "reasoning ток./вызов"];
  if (task === "voice") {
    return {
      headers: ["модель", "CER", "CER > 60 с", ...commonHead],
      rows: [...accs].map(([m, a]) => [m, a.avg("cer", 3), a.avg("cerLong", 3), ...common(a)]),
    };
  }
  const itemHead = ["валидный JSON", "precision", "recall", "MAPE ккал", "ккал в диапазоне", "MAPE суммы", "MAE Б/Ж/У, г", "БЖУ в диапазоне", "hydrating", "mealType"];
  const itemCols = (a: Acc) => [
    a.jsonCalls ? `${((a.jsonValid / a.jsonCalls) * 100).toFixed(0)}%` : "—",
    a.avg("precision", 2), a.avg("recall", 2),
    a.avg("kcalApe", 0, true), a.rate("kcalInRange"), a.avg("totalKcalApe", 0, true),
    `${a.avg("maeP")}/${a.avg("maeF")}/${a.avg("maeC")}`,
    a.rate("macroInRange"), a.rate("hydrating"), a.rate("mealType"),
  ];
  if (task === "text") {
    return {
      headers: ["модель", "intent", ...itemHead, "тренировка ккал", ...commonHead],
      rows: [...accs].map(([m, a]) => [m, a.rate("intent"), ...itemCols(a), a.rate("workoutInRange"), ...common(a)]),
    };
  }
  return {
    headers: ["модель", ...itemHead, ...commonHead],
    rows: [...accs].map(([m, a]) => [m, ...itemCols(a), ...common(a)]),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  // Ключ проверяем до всего остального: без него eval бессмыслен.
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("Не задан OPENROUTER_API_KEY. Запуск: OPENROUTER_API_KEY=... npx tsx scripts/eval-models.ts --task text (ключ берётся только из окружения).");
  }
  const args = parseArgs(process.argv.slice(2));

  // config.ts требует переменные бота; eval их не использует.
  process.env.TELEGRAM_BOT_TOKEN ||= "eval-unused";
  process.env.DATABASE_URL ||= "postgres://eval-unused/eval";
  const { config } = await import("../server/config");
  const ai = await import("../server/openai");

  if (args.task === "photo") {
    try { await access(PHOTO_MANIFEST); } catch {
      throw new Error("Нет eval/photos/manifest.json — см. eval/photos/manifest.example.json и eval/README.md.");
    }
  }

  const role = TASK_ROLE[args.task];
  const models = args.models.length ? args.models : [config.aiModels[role]];
  for (const r of Object.keys(config.aiFallbackModels) as (keyof typeof config.aiFallbackModels)[]) {
    config.aiFallbackModels[r] = undefined;
  }
  if (args.reasoning) config.aiReasoningEffort = args.reasoning as typeof config.aiReasoningEffort;

  ai.setAICallObserver(({ fnName, model, response }) => {
    const u: any = response.usage ?? {};
    callStore.getStore()?.push({
      fnName,
      model,
      content: response.choices[0]?.message?.content ?? "",
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      cost: typeof u.cost === "number" ? u.cost : null,
    });
  });

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const outDir = path.join(EVAL_DIR, "results", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${args.task}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`);
  await mkdir(outDir, { recursive: true });
  const rawFile = path.join(outDir, "raw.jsonl");
  const writeRaw = (rec: unknown) => appendFile(rawFile, JSON.stringify(rec) + "\n");

  const evalTime = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2026, 0, 15, h, m);
  };

  const accs = new Map<string, Acc>();
  const limit = pLimit(args.concurrency);
  let done = 0;
  let total = 0;
  const progress = () => {
    done++;
    if (done % 10 === 0 || done === total) process.stdout.write(`  ${done}/${total}\r`);
  };

  for (const model of models) {
    config.aiModels[role] = model;
    const acc = new Acc();
    accs.set(model, acc);
    console.log(`\n${args.task}: ${model}`);
    const jobs: Promise<void>[] = [];
    done = 0;

    if (args.task === "text") {
      const data = JSON.parse(await readFile(path.join(EVAL_DIR, "cases", "text.json"), "utf8"));
      const cases = (data.cases as any[]).slice(0, args.limit);
      total = cases.length * args.repeat;
      for (let r = 0; r < args.repeat; r++) for (const c of cases) jobs.push(limit(guard(acc, async () => {
        acc.units++;
        const rec: any = { model, repeat: r, id: c.id };
        const intent = await timed(() => ai.classifyIntent(c.text));
        acc.call(intent, true);
        // На ошибке API classifyIntent возвращает "food" — это не ответ модели.
        acc.push("intent", intent.calls.length ? intent.value === c.intent : false);
        rec.intent = { value: intent.value, latencyMs: intent.latencyMs, raw: intent.calls.map((x) => x.content) };

        if (c.intent === "food" || c.intent === "both") {
          const food = await timed(() => ai.analyzeFoodText(c.text, evalTime(data.evalTime ?? "13:00")));
          acc.call(food, true);
          acc.items(scoreFoodItems((c.items ?? []) as ExpectedFoodItem[], (food.value ?? []) as any[]), food.calls.length > 0);
          rec.food = { value: food.value, latencyMs: food.latencyMs, raw: food.calls.map((x) => x.content) };
        }
        if (c.workout) {
          const w = await timed(() => ai.analyzeWorkout(c.text, data.userWeightKg ?? 70));
          acc.call(w, true);
          acc.push("workoutInRange", w.value ? inRange(w.value.caloriesBurned, c.workout.caloriesBurned as Range) : false);
          acc.push("workoutApe", w.value ? absPctError(w.value.caloriesBurned, c.workout.caloriesBurned) : null);
          rec.workout = { value: w.value, latencyMs: w.latencyMs, raw: w.calls.map((x) => x.content) };
        }
        await writeRaw(rec);
        progress();
      })));
    }

    if (args.task === "photo") {
      const data = JSON.parse(await readFile(PHOTO_MANIFEST, "utf8"));
      const items = (data.items as any[]).slice(0, args.limit);
      total = items.length * args.repeat;
      for (let r = 0; r < args.repeat; r++) for (const p of items) jobs.push(limit(guard(acc, async () => {
        acc.units++;
        const b64 = (await readFile(path.join(EVAL_DIR, "photos", p.file))).toString("base64");
        const res = await timed(() => ai.analyzeFoodImage(b64, evalTime(p.takenAt ?? data.evalTime ?? "13:00"), undefined, p.caption ? { userNote: p.caption } : undefined));
        acc.call(res, true);
        acc.items(scoreFoodItems((p.expected ?? []) as ExpectedFoodItem[], (res.value ?? []) as any[]), res.calls.length > 0);
        await writeRaw({ model, repeat: r, file: p.file, value: res.value, latencyMs: res.latencyMs, raw: res.calls.map((x) => x.content) });
        progress();
      })));
    }

    if (args.task === "voice") {
      const data = JSON.parse(await readFile(path.join(EVAL_DIR, "voice", "manifest.json"), "utf8"));
      // Личные голосовые и их расшифровки — в отдельном манифесте под .gitignore.
      const personalPath = path.join(EVAL_DIR, "voice", "manifest.personal.json");
      const personal = await readFile(personalPath, "utf8").then((t) => JSON.parse(t).items as any[], () => []);
      const items = [...(data.items as any[]), ...personal].slice(0, args.limit);
      total = items.length * args.repeat;
      for (let r = 0; r < args.repeat; r++) for (const v of items) jobs.push(limit(guard(acc, async () => {
        acc.units++;
        const buf = await readFile(path.join(EVAL_DIR, "voice", v.file));
        const res = await timed(() => ai.transcribeVoice(buf, v.durationSec));
        acc.call(res, false);
        const best = Math.min(...(v.references as string[]).map((ref) => cer(ref, res.value ?? "")));
        acc.push("cer", best);
        if (v.durationSec > 60) acc.push("cerLong", best);
        await writeRaw({ model, repeat: r, id: v.id, value: res.value, cer: best, chunks: res.calls.length, latencyMs: res.latencyMs });
        progress();
      })));
    }

    await Promise.all(jobs);
    process.stdout.write("\n");
  }

  ai.setAICallObserver(null);
  const { headers, rows } = summaryRows(args.task, accs);
  const table = markdownTable(headers, rows);
  const md = [
    `# eval ${args.task} — ${now.toISOString()}`,
    "",
    `repeat=${args.repeat}${args.limit ? `, limit=${args.limit}` : ""}${args.reasoning ? `, reasoning=${args.reasoning}` : ""}`,
    "",
    table,
    "",
    "MAPE и MAE — от середины эталонного диапазона, по сопоставленным позициям; «в диапазоне» — доля попаданий в эталонный диапазон (в скобках — число проверок). Латентность — на вызов функции, с ретраями.",
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "summary.md"), md);
  console.log("\n" + table);
  console.log(`\nСырые ответы и summary.md: ${path.relative(ROOT, outDir)}`);
}

main().catch((err) => {
  // Только message: в объекте ошибки SDK бывают заголовки запроса.
  console.error(`eval: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
