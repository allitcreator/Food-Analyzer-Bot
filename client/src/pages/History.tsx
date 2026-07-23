import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import type { DayResponse, FoodLog, UpdateLogBody } from "@/lib/types";
import {
  addDaysISO,
  formatDateHuman,
  isToday,
  MEAL_LABELS,
  MEAL_ORDER,
  round,
  todayISO,
} from "@/lib/format";
import { hapticNotification, hapticSelection } from "@/lib/telegram";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { MealGroups } from "@/components/MealGroups";
import { ErrorScreen } from "@/components/StateScreens";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field, Select } from "@/components/ui/Input";

export default function History() {
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(todayISO());
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const [deleting, setDeleting] = useState<FoodLog | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<DayResponse>({
    queryKey: ["day", date],
    queryFn: () => api.day(date),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["day"] });

  const delMutation = useMutation({
    mutationFn: (id: number) => api.deleteLog(id),
    onSuccess: () => {
      hapticNotification("success");
      setDeleting(null);
      invalidate();
    },
  });

  const shift = (d: number) => {
    hapticSelection();
    setDate((cur) => addDaysISO(cur, d));
  };

  return (
    <div>
      <PageHeader title="История" />
      <div className="space-y-4 px-4">
        <Card>
          <CardContent className="flex items-center justify-between pt-4">
            <button
              onClick={() => shift(-1)}
              className="rounded-full p-2 hover:bg-secondary"
              aria-label="Предыдущий день"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <label className="flex flex-col items-center">
              <span className="text-[15px] font-semibold">{formatDateHuman(date)}</span>
              <input
                type="date"
                value={date}
                max={todayISO()}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="mt-1 bg-transparent text-xs text-muted-foreground outline-none"
              />
            </label>
            <button
              onClick={() => shift(1)}
              disabled={isToday(date)}
              className="rounded-full p-2 hover:bg-secondary disabled:opacity-30"
              aria-label="Следующий день"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </CardContent>
        </Card>

        {isError ? (
          <ErrorScreen error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <>
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </>
        ) : (
          <>
            <MealGroups logs={data.foodLogs} onEdit={setEditing} onDelete={setDeleting} />
            {data.foodLogs.length > 0 && <DayTotals data={data} />}
          </>
        )}
      </div>

      <EditFoodModal
        log={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />

      <Modal open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Удалить запись?">
        <p className="mb-5 text-sm text-muted-foreground">
          «{deleting?.foodName}» будет удалено безвозвратно.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleting(null)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={delMutation.isPending}
            onClick={() => deleting && delMutation.mutate(deleting.id)}
          >
            Удалить
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function DayTotals({ data }: { data: DayResponse }) {
  const t = data.totals;
  return (
    <Card>
      <CardContent className="grid grid-cols-4 gap-2 pt-4 text-center">
        <Totd label="Ккал" value={round(t.calories)} />
        <Totd label="Белки" value={round(t.protein)} />
        <Totd label="Жиры" value={round(t.fat)} />
        <Totd label="Углев." value={round(t.carbs)} />
      </CardContent>
    </Card>
  );
}

function Totd({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Edit modal: changing weight proportionally rescales KБЖУ on the client. */
function EditFoodModal({
  log,
  onClose,
  onSaved,
}: {
  log: FoodLog | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Modal open={!!log} onOpenChange={(o) => !o && onClose()} title="Редактировать">
      {log && <EditForm key={log.id} log={log} onSaved={onSaved} />}
    </Modal>
  );
}

function EditForm({ log, onSaved }: { log: FoodLog; onSaved: () => void }) {
  const [foodName, setFoodName] = useState(log.foodName);
  const [mealType, setMealType] = useState(log.mealType);
  const [weight, setWeight] = useState(String(log.weight));
  const [calories, setCalories] = useState(String(log.calories));
  const [protein, setProtein] = useState(String(log.protein));
  const [fat, setFat] = useState(String(log.fat));
  const [carbs, setCarbs] = useState(String(log.carbs));

  const onWeightChange = (raw: string) => {
    setWeight(raw);
    const w = Number(raw);
    if (log.weight > 0 && w > 0) {
      const ratio = w / log.weight;
      setCalories(String(Math.round(log.calories * ratio)));
      setProtein(String(Math.round(log.protein * ratio)));
      setFat(String(Math.round(log.fat * ratio)));
      setCarbs(String(Math.round(log.carbs * ratio)));
    }
  };

  const mutation = useMutation({
    mutationFn: (body: UpdateLogBody) => api.updateLog(log.id, body),
    onSuccess: () => {
      hapticNotification("success");
      onSaved();
    },
  });

  const save = () => {
    const body: UpdateLogBody = {
      foodName: foodName.trim() || log.foodName,
      mealType: mealType as UpdateLogBody["mealType"],
      weight: Math.max(0, Math.round(Number(weight) || 0)),
      calories: Math.max(0, Math.round(Number(calories) || 0)),
      protein: Math.max(0, Math.round(Number(protein) || 0)),
      fat: Math.max(0, Math.round(Number(fat) || 0)),
      carbs: Math.max(0, Math.round(Number(carbs) || 0)),
    };
    mutation.mutate(body);
  };

  return (
    <div className="space-y-3">
      <Field label="Название">
        <Input value={foodName} onChange={(e) => setFoodName(e.target.value)} />
      </Field>
      <Field label="Приём пищи">
        <Select value={mealType} onChange={(e) => setMealType(e.target.value)}>
          {MEAL_ORDER.map((m) => (
            <option key={m} value={m}>
              {MEAL_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Вес, г (пересчитает КБЖУ)">
        <Input type="number" inputMode="numeric" value={weight} onChange={(e) => onWeightChange(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Калории">
          <Input type="number" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />
        </Field>
        <Field label="Белки, г">
          <Input type="number" inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </Field>
        <Field label="Жиры, г">
          <Input type="number" inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} />
        </Field>
        <Field label="Углеводы, г">
          <Input type="number" inputMode="numeric" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
        </Field>
      </div>
      <Button className="mt-2 w-full" disabled={mutation.isPending} onClick={save}>
        Сохранить
      </Button>
    </div>
  );
}
