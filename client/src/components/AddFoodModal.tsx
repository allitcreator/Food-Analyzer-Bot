/**
 * Шторка «Добавить еду» — двухшаговый ручной ввод в Mini App, как в боте:
 *   шаг 1 — приём пищи, описание текстом / голосом, фото еды или штрихкода,
 *           либо запись из избранного в один тап → «Распознать» (AI-анализ);
 *   шаг 2 — «Проверьте»: правка веса степпером (БЖУ пересчитываются
 *           пропорционально), удаление позиций → «Записать». Гидратирующие
 *           позиции уходят в счётчик воды. Выбранный приём ставится всем позициям.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, X, Square } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AnalyzedItem, AnalyzeResponse, Favorite, MealType, MeResponse } from "@/lib/types";
import { compressImageToBase64 } from "@/lib/image";
import { scaleFoodByWeight } from "@shared/food-scale";
import { mealTypeByMinutes } from "@shared/meal-time";
import { minutesInTimeZone } from "@/lib/date-tz";
import { MEAL_LABELS, MEAL_ORDER, round } from "@/lib/format";
import { invalidateDiary } from "@/lib/invalidate";
import { hapticImpact, hapticNotification, hapticSelection } from "@/lib/telegram";
import {
  blobToBase64,
  MAX_AUDIO_BASE64_CHARS,
  MAX_RECORD_SECONDS,
  useVoiceRecorder,
} from "@/lib/voice";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Button, IconButton } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { SectionCaps } from "@/components/ui/Card";
import { FavoriteChips } from "@/components/FavoriteChips";
import { toast, toastError } from "@/components/ui/Toast";
import { isValidFoodWeight, MAX_FOOD_WEIGHT } from "@/lib/food-weight";

/** Строка результата: неизменяемый оригинал + текущий (правимый) вес. */
interface Row {
  original: AnalyzedItem;
  weight: number;
}

/** Шаг степпера веса, г/мл. */
const WEIGHT_STEP = 10;

type AnalyzeInput =
  | { kind: "text"; text: string }
  | { kind: "image"; file: File; mode: "photo" | "barcode" };

/** Приём по умолчанию — по времени суток в таймзоне профиля. */
function mealTypeNow(me: MeResponse | undefined): MealType {
  return mealTypeByMinutes(minutesInTimeZone(me?.timezone), {
    breakfastEnd: me?.mealBreakfastEnd ?? "12:30",
    lunchEnd: me?.mealLunchEnd ?? "16:30",
  });
}

const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function AddFoodModal({
  open,
  onOpenChange,
  initialMealType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMealType?: MealType;
}) {
  const qc = useQueryClient();
  const photoInput = useRef<HTMLInputElement>(null);
  const barcodeInput = useRef<HTMLInputElement>(null);
  const me = useQuery<MeResponse>({ queryKey: ["me"], queryFn: api.me });
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: api.favorites, enabled: open });

  const [mealType, setMealType] = useState<MealType>(() => initialMealType ?? mealTypeNow(me.data));
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<AnalyzeResponse["source"]>();

  // Object URL превью живёт до закрытия шторки — освобождаем при размонтировании.
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview;
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const clearPreview = () => {
    setPreview((cur) => {
      if (cur) URL.revokeObjectURL(cur);
      return null;
    });
    setFile(null);
    if (photoInput.current) photoInput.current.value = "";
  };

  const transcribeMutation = useMutation({
    mutationFn: async ({ blob, mimeType }: { blob: Blob; mimeType: string }) => {
      const audioBase64 = await blobToBase64(blob);
      if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) throw new ApiError(422, "too_long");
      return (await api.transcribe({ audioBase64, mimeType })).text;
    },
    onSuccess: (spoken) => {
      hapticNotification("success");
      // Распознанное дописываем к уже набранному — пользователь правит и жмёт «Распознать».
      setText((cur) => (cur.trim() ? `${cur.trim()} ${spoken}` : spoken));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.reason === "too_long") {
        hapticNotification("error");
        toast("Запись слишком длинная");
        return;
      }
      if (err instanceof ApiError && err.reason === "unrecognized") {
        hapticNotification("error");
        toast("Не удалось разобрать речь");
        return;
      }
      toastError(err, "Не удалось распознать голос");
    },
  });

  const voice = useVoiceRecorder({
    onRecorded: (blob, mimeType) => transcribeMutation.mutate({ blob, mimeType }),
    onError: () => {
      hapticNotification("error");
      toast("Микрофон недоступен в этом клиенте Telegram");
    },
  });

  const reset = () => {
    voice.cancel();
    setText("");
    clearPreview();
    setRows(null);
    setSource(undefined);
    analyzeMutation.reset();
    logMutation.reset();
    transcribeMutation.reset();
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const analyzeMutation = useMutation({
    mutationFn: async (input: AnalyzeInput): Promise<AnalyzeResponse> => {
      if (input.kind === "image") {
        const imageBase64 = await compressImageToBase64(input.file);
        return api.analyzeFood({ imageBase64, mode: input.mode });
      }
      return api.analyzeFood({ text: input.text });
    },
    onSuccess: (res) => {
      hapticNotification("success");
      setSource(res.source);
      setRows(res.items.map((it) => ({ original: it, weight: it.weight })));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.reason === "no_barcode") {
        hapticNotification("error");
        toast("Штрихкод на фото не найден");
        return;
      }
      if (err instanceof ApiError && err.reason === "unrecognized") {
        hapticNotification("error");
        toast("Не удалось распознать еду");
        return;
      }
      // Ошибки сжатия фото (не ApiError) несут понятный текст сами.
      if (!(err instanceof ApiError) && !(err instanceof TypeError) && err instanceof Error) {
        hapticNotification("error");
        toast(err.message);
        return;
      }
      toastError(err, "Ошибка анализа, попробуйте ещё раз");
    },
  });

  const logMutation = useMutation({
    mutationFn: (items: AnalyzedItem[]) => api.createLogs(items),
    onSuccess: () => {
      hapticNotification("success");
      toast("Записано");
      invalidateDiary(qc);
      handleOpenChange(false);
    },
    onError: (err) => toastError(err, "Не удалось записать"),
  });

  const favoriteMutation = useMutation({
    mutationFn: (fav: Favorite) => api.logFavorite(fav.id),
    onSuccess: (_res, fav) => {
      hapticNotification("success");
      toast(`Записано: ${fav.title}`);
      invalidateDiary(qc);
      handleOpenChange(false);
    },
    onError: (err) => toastError(err, "Не удалось записать"),
  });

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  // Штрихкод распознаём сразу: добавить к снимку больше нечего.
  const onPickBarcode = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (f) analyzeMutation.mutate({ kind: "image", file: f, mode: "barcode" });
  };

  const setWeight = (i: number, w: number) =>
    setRows((cur) => (cur ? cur.map((r, idx) => (idx === i ? { ...r, weight: w } : r)) : cur));

  const removeRow = (i: number) => {
    hapticImpact("light");
    setRows((cur) => (cur ? cur.filter((_, idx) => idx !== i) : cur));
  };

  const busy =
    analyzeMutation.isPending ||
    transcribeMutation.isPending ||
    favoriteMutation.isPending ||
    voice.recording;
  const allWeightsValid = !!rows && rows.every((r) => isValidFoodWeight(r.weight));
  const canAnalyze = (text.trim().length > 0 || !!file) && !busy;

  const analyze = () => {
    if (file) analyzeMutation.mutate({ kind: "image", file, mode: "photo" });
    else analyzeMutation.mutate({ kind: "text", text: text.trim() });
  };

  const submit = () => {
    if (!rows || rows.length === 0) return;
    if (!allWeightsValid) {
      hapticNotification("error");
      toast("Укажите вес больше 0");
      return;
    }
    const items = rows.map((r) => ({ ...scaleFoodByWeight(r.original, r.weight), mealType }));
    logMutation.mutate(items);
  };

  const favList = favorites.data?.favorites ?? [];

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title={rows === null ? "Добавить еду" : "Проверьте"}>
      {rows === null ? (
        // ─── Шаг 1: ввод ─────────────────────────────────────────────────────
        <div>
          <div className="mb-3.5 flex gap-1.5" role="radiogroup" aria-label="Приём пищи">
            {MEAL_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mealType === m}
                onClick={() => {
                  hapticSelection();
                  setMealType(m);
                }}
                className={cn(
                  "flex-1 rounded-xl py-2 text-[13px] font-semibold",
                  mealType === m ? "bg-accent-soft text-primary" : "bg-fill text-muted-foreground",
                )}
              >
                {MEAL_LABELS[m]}
              </button>
            ))}
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Опиши, что съел… Например: овсянка на воде 200 г и кофе без сахара"
            disabled={analyzeMutation.isPending}
          />

          <input ref={photoInput} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
          <input
            ref={barcodeInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickBarcode}
            className="hidden"
          />

          {preview && (
            <div className="relative mt-3 overflow-hidden rounded-[18px]">
              <img src={preview} alt="Выбранное фото" className="max-h-56 w-full object-cover" />
              <button
                onClick={clearPreview}
                disabled={analyzeMutation.isPending}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-50"
                aria-label="Убрать фото"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {voice.recording ? (
            <div className="my-3 flex items-center gap-3 rounded-[18px] bg-card p-3.5 shadow-soft">
              <span className="h-3 w-3 animate-pulse rounded-full bg-destructive" aria-hidden />
              <span className="flex-1 text-[15px] font-semibold">
                Запись {formatSeconds(voice.seconds)}
                <span className="font-normal text-muted-foreground"> / {formatSeconds(MAX_RECORD_SECONDS)}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={voice.stop}>
                <Square className="h-3.5 w-3.5 fill-current" /> Стоп
              </Button>
            </div>
          ) : transcribeMutation.isPending ? (
            <div className="my-3 flex items-center justify-center gap-2 rounded-[18px] bg-card p-3.5 text-sm text-muted-foreground shadow-soft">
              <Loader2 className="h-4 w-4 animate-spin" /> Расшифровываю голос…
            </div>
          ) : (
            <div className="my-3 grid grid-cols-3 gap-2.5">
              <ModeTile emoji="📷" label="Фото" disabled={busy} onClick={() => photoInput.current?.click()} />
              <ModeTile emoji="▥" label="Штрихкод" disabled={busy} onClick={() => barcodeInput.current?.click()} />
              <ModeTile emoji="🎙️" label="Голосом" disabled={busy} onClick={() => void voice.start()} />
            </div>
          )}

          {favList.length > 0 && (
            <>
              <SectionCaps>Из избранного</SectionCaps>
              <FavoriteChips
                favorites={favList}
                disabled={busy || logMutation.isPending}
                onPick={(fav) => {
                  hapticImpact("medium");
                  favoriteMutation.mutate(fav);
                }}
                className="mb-4"
              />
            </>
          )}

          <Button className="w-full" disabled={!canAnalyze} onClick={analyze}>
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Распознаю…
              </>
            ) : (
              "Распознать"
            )}
          </Button>

          {analyzeMutation.isPending && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              AI анализирует — это занимает несколько секунд.
            </p>
          )}
        </div>
      ) : (
        // ─── Шаг 2: подтверждение ────────────────────────────────────────────
        <div>
          {source === "barcode" && (
            <p className="mb-2.5 px-1 text-[13px] font-semibold text-muted-foreground">📦 Найдено по штрихкоду</p>
          )}
          {rows.map((row, i) => (
            <ResultRow
              key={i}
              row={row}
              mealType={mealType}
              canRemove={rows.length > 1}
              onWeight={(w) => setWeight(i, w)}
              onRemove={() => removeRow(i)}
            />
          ))}

          <Totals rows={rows} />

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={logMutation.isPending}
              onClick={() => {
                setRows(null);
                setSource(undefined);
              }}
            >
              Назад
            </Button>
            <Button
              className="flex-[2]"
              disabled={logMutation.isPending || rows.length === 0 || !allWeightsValid}
              onClick={submit}
            >
              {logMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Записываю…
                </>
              ) : (
                `Записать (${rows.length})`
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ModeTile({
  emoji,
  label,
  onClick,
  disabled,
}: {
  emoji: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        hapticImpact("light");
        onClick();
      }}
      disabled={disabled}
      className="rounded-[18px] bg-card px-1.5 py-3.5 text-center text-[13px] font-semibold shadow-soft active:scale-[0.97] disabled:opacity-50"
    >
      <span className="mb-1 block text-2xl leading-none" aria-hidden>
        {emoji}
      </span>
      {label}
    </button>
  );
}

/** Строка «Итого» по всем позициям с текущими весами. */
function Totals({ rows }: { rows: Row[] }) {
  const sum = rows.reduce(
    (acc, r) => {
      const s = scaleFoodByWeight(r.original, r.weight);
      return {
        calories: acc.calories + s.calories,
        protein: acc.protein + s.protein,
        fat: acc.fat + s.fat,
        carbs: acc.carbs + s.carbs,
      };
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
  return (
    <div className="mx-1 mb-3 mt-1.5 flex justify-between gap-2 text-sm">
      <span className="text-muted-foreground">Итого</span>
      <b>
        {round(sum.calories)} ккал · Б {round(sum.protein)} · Ж {round(sum.fat)} · У {round(sum.carbs)}
      </b>
    </div>
  );
}

/** Одна позиция на шаге подтверждения: название, приём, вес степпером, пересчёт БЖУ. */
function ResultRow({
  row,
  mealType,
  canRemove,
  onWeight,
  onRemove,
}: {
  row: Row;
  mealType: MealType;
  canRemove: boolean;
  onWeight: (w: number) => void;
  onRemove: () => void;
}) {
  const scaled = scaleFoodByWeight(row.original, row.weight);
  const hydrating = row.original.hydrating === true;
  const invalid = !isValidFoodWeight(row.weight);
  const unit = hydrating ? "мл" : "г";
  const clamp = (w: number) => Math.max(0, Math.min(MAX_FOOD_WEIGHT, w));
  const step = (delta: number) => {
    hapticSelection();
    // Минус не уводит в 0: минимальный шаг — до WEIGHT_STEP.
    onWeight(clamp(Math.max(delta < 0 ? WEIGHT_STEP : 0, Math.round(row.weight) + delta)));
  };

  return (
    <div className="mb-2.5 rounded-[18px] bg-card p-3.5 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{row.original.foodName}</p>
          {!hydrating && (
            <span className="mt-1.5 inline-flex rounded-xl bg-accent-soft px-2.5 py-[5px] text-[13px] font-semibold text-primary">
              {MEAL_LABELS[mealType]}
            </span>
          )}
        </div>
        {canRemove && (
          <IconButton onClick={onRemove} aria-label={`Убрать ${row.original.foodName}`}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <div className="mt-2.5 flex items-center">
        <div className="flex items-center rounded-xl bg-fill">
          <button
            type="button"
            onClick={() => step(-WEIGHT_STEP)}
            disabled={row.weight <= WEIGHT_STEP}
            className="px-3 py-1 text-lg font-semibold text-primary disabled:opacity-40"
            aria-label={`Меньше на ${WEIGHT_STEP} ${unit}`}
          >
            −
          </button>
          <label className="flex items-baseline gap-1 py-[7px] text-[15px] font-semibold">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_FOOD_WEIGHT}
              value={row.weight}
              onChange={(e) => onWeight(clamp(Number(e.target.value) || 0))}
              className={cn(
                "w-14 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
                invalid && "text-destructive",
              )}
              aria-label={hydrating ? "Объём, мл" : "Вес, г"}
              aria-invalid={invalid}
            />
            {unit}
          </label>
          <button
            type="button"
            onClick={() => step(WEIGHT_STEP)}
            disabled={row.weight >= MAX_FOOD_WEIGHT}
            className="px-3 py-1 text-lg font-semibold text-primary disabled:opacity-40"
            aria-label={`Больше на ${WEIGHT_STEP} ${unit}`}
          >
            +
          </button>
        </div>
      </div>

      {invalid ? (
        <p className="mt-2 text-xs text-destructive">Вес должен быть больше 0</p>
      ) : hydrating ? (
        <p className="mt-2 text-xs font-semibold text-water">💧 Пойдёт в воду: +{round(row.weight)} мл</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {round(scaled.calories)} ккал · Б {round(scaled.protein)} · Ж {round(scaled.fat)} · У{" "}
          {round(scaled.carbs)}
        </p>
      )}
    </div>
  );
}
