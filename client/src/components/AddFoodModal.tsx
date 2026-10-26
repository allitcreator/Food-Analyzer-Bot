/**
 * Модалка «Добавить еду» — двухшаговый ручной ввод в Mini App, как в боте:
 *   шаг 1 — описать текстом ИЛИ приложить фото → «Распознать» (AI-анализ);
 *   шаг 2 — правка веса (БЖУ пересчитываются пропорционально), удаление позиций
 *           → «Записать». Гидратирующие позиции уходят в счётчик воды.
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Trash2, Droplet, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AnalyzedItem } from "@/lib/types";
import { compressImageToBase64 } from "@/lib/image";
import { scaleFoodByWeight } from "@shared/food-scale";
import { MEAL_LABELS, round } from "@/lib/format";
import { hapticImpact, hapticNotification } from "@/lib/telegram";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast, toastError } from "@/components/ui/Toast";
import { isValidFoodWeight, MAX_FOOD_WEIGHT } from "@/lib/food-weight";

/** Строка результата: неизменяемый оригинал + текущий (правимый) вес. */
interface Row {
  original: AnalyzedItem;
  weight: number;
}

export function AddFoodModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  const clearPreview = () => {
    setPreview((cur) => {
      if (cur) URL.revokeObjectURL(cur);
      return null;
    });
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const reset = () => {
    setText("");
    clearPreview();
    setRows(null);
    analyzeMutation.reset();
    logMutation.reset();
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const analyzeMutation = useMutation({
    mutationFn: async (): Promise<AnalyzedItem[]> => {
      if (file) {
        const imageBase64 = await compressImageToBase64(file);
        return (await api.analyzeFood({ imageBase64 })).items;
      }
      return (await api.analyzeFood({ text: text.trim() })).items;
    },
    onSuccess: (items) => {
      hapticNotification("success");
      setRows(items.map((it) => ({ original: it, weight: it.weight })));
    },
    onError: (err) => {
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
      // Today активен под модалкой — обычная инвалидация без refetchType.
      qc.invalidateQueries({ queryKey: ["day"] });
      handleOpenChange(false);
    },
    onError: (err) => toastError(err, "Не удалось записать"),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const setWeight = (i: number, w: number) =>
    setRows((cur) => (cur ? cur.map((r, idx) => (idx === i ? { ...r, weight: w } : r)) : cur));

  const removeRow = (i: number) => {
    hapticImpact("light");
    setRows((cur) => (cur ? cur.filter((_, idx) => idx !== i) : cur));
  };

  const allWeightsValid = !!rows && rows.every((r) => isValidFoodWeight(r.weight));

  const canAnalyze = (text.trim().length > 0 || !!file) && !analyzeMutation.isPending;

  const submit = () => {
    if (!rows || rows.length === 0) return;
    if (!allWeightsValid) {
      hapticNotification("error");
      toast("Укажите вес больше 0");
      return;
    }
    const items = rows.map((r) => scaleFoodByWeight(r.original, r.weight));
    logMutation.mutate(items);
  };

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title="Добавить еду">
      {rows === null ? (
        // ─── Шаг 1: ввод ─────────────────────────────────────────────────────
        <div className="space-y-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Опиши, что съел… Например: овсянка на воде 200 г и кофе без сахара"
            rows={3}
            disabled={analyzeMutation.isPending}
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60"
          />

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={onPickFile}
            className="hidden"
          />

          {preview ? (
            <div className="relative overflow-hidden rounded-xl border border-card-border">
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
          ) : (
            <Button
              variant="secondary"
              className="w-full"
              disabled={analyzeMutation.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <Camera className="h-4 w-4" /> Фото
            </Button>
          )}

          <Button className="w-full" disabled={!canAnalyze} onClick={() => analyzeMutation.mutate()}>
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Распознаю…
              </>
            ) : (
              "Распознать"
            )}
          </Button>

          {analyzeMutation.isPending && (
            <p className="text-center text-xs text-muted-foreground">
              AI анализирует — это занимает несколько секунд.
            </p>
          )}
        </div>
      ) : (
        // ─── Шаг 2: подтверждение ────────────────────────────────────────────
        <div className="space-y-3">
          <div className="space-y-2">
            {rows.map((row, i) => (
              <ResultRow
                key={i}
                row={row}
                canRemove={rows.length > 1}
                onWeight={(w) => setWeight(i, w)}
                onRemove={() => removeRow(i)}
              />
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={logMutation.isPending}
              onClick={() => setRows(null)}
            >
              Назад
            </Button>
            <Button
              className="flex-1"
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

/** Одна позиция на шаге подтверждения: название, приём, вес, пересчёт БЖУ. */
function ResultRow({
  row,
  canRemove,
  onWeight,
  onRemove,
}: {
  row: Row;
  canRemove: boolean;
  onWeight: (w: number) => void;
  onRemove: () => void;
}) {
  const scaled = scaleFoodByWeight(row.original, row.weight);
  const hydrating = row.original.hydrating === true;
  const invalid = !isValidFoodWeight(row.weight);

  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium">{row.original.foodName}</p>
          <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {MEAL_LABELS[row.original.mealType] ?? row.original.mealType}
          </span>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="shrink-0 rounded-full p-1.5 text-destructive hover:bg-secondary"
            aria-label={`Убрать ${row.original.foodName}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_FOOD_WEIGHT}
          value={row.weight}
          onChange={(e) =>
            onWeight(Math.max(0, Math.min(MAX_FOOD_WEIGHT, Number(e.target.value) || 0)))
          }
          className={`h-9 w-24 ${invalid ? "border-destructive" : ""}`}
          aria-label="Вес, г"
          aria-invalid={invalid}
        />
        <span className="text-sm text-muted-foreground">{hydrating ? "мл" : "г"}</span>
      </div>

      {invalid ? (
        <p className="mt-2 text-xs text-destructive">Вес должен быть больше 0</p>
      ) : hydrating ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-chart-1">
          <Droplet className="h-3.5 w-3.5" /> Пойдёт в воду: +{round(row.weight)} мл
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {round(scaled.calories)} ккал · Б {round(scaled.protein)} · Ж {round(scaled.fat)} · У{" "}
          {round(scaled.carbs)}
        </p>
      )}
    </div>
  );
}
