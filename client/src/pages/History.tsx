import { useState } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, RotateCw, Star, Trash2, Utensils } from "lucide-react";
import { api } from "@/lib/api";
import type { DayResponse, FoodLog, MeResponse, UpdateLogBody, WeekStatsResponse } from "@/lib/types";
import {
  addDaysISO,
  formatDateLong,
  formatDateRange,
  MEAL_LABELS,
  MEAL_ORDER,
  round,
} from "@/lib/format";
import { todayInTimeZone } from "@/lib/date-tz";
import { invalidateDiary } from "@/lib/invalidate";
import { hapticNotification, hapticSelection } from "@/lib/telegram";
import { hasFavoriteTitle } from "@shared/favorites-filter";
import { PageHeader } from "@/components/PageHeader";
import { Card, SectionHeading } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { WeekBars } from "@/components/WeekBars";
import { MacroPills } from "@/components/MacroPills";
import { ErrorScreen } from "@/components/StateScreens";
import { Modal, SheetAction } from "@/components/ui/Modal";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Field, Select } from "@/components/ui/Input";
import { toast, toastError } from "@/components/ui/Toast";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Целых дней от `a` до `b` (ISO-даты, b ≥ a). */
function daysBetween(a: string, b: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Конец недели (шаг 7 дней от сегодня), в которую попадает `date`. */
function weekEndFor(date: string, today: string): string {
  return addDaysISO(today, -Math.floor(daysBetween(date, today) / 7) * 7);
}

export default function History() {
  const qc = useQueryClient();
  // «Сегодня» — по таймзоне профиля, как на сервере, а не по часам устройства.
  // /me уже в кэше: App не рендерит вкладки, пока он не загружен.
  const me = useQuery<MeResponse>({ queryKey: ["me"], queryFn: api.me });
  const today = todayInTimeZone(me.data?.timezone);
  // ?date=YYYY-MM-DD — день, выбранный тапом по неделе на «Сегодня».
  const search = useSearch();
  const [date, setDate] = useState<string>(() => {
    const fromUrl = new URLSearchParams(search).get("date");
    return fromUrl && ISO_RE.test(fromUrl) && fromUrl <= today ? fromUrl : today;
  });
  const [weekEnd, setWeekEnd] = useState(() => weekEndFor(date, today));
  const [menuFor, setMenuFor] = useState<FoodLog | null>(null);
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const [deleting, setDeleting] = useState<FoodLog | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<DayResponse>({
    queryKey: ["day", date],
    queryFn: () => api.day(date),
  });
  const week = useQuery({
    queryKey: ["stats", "week", weekEnd],
    queryFn: () => api.stats("week", weekEnd) as Promise<WeekStatsResponse>,
  });

  // Own favorites — to show a filled star on already-saved dishes and to avoid
  // creating duplicates when the star is tapped again.
  const { data: favData } = useQuery({
    queryKey: ["favorites"],
    queryFn: api.favorites,
  });
  const ownFavTitles = (favData?.favorites ?? [])
    .filter((f) => f.isOwner)
    .map((f) => f.title);

  const delMutation = useMutation({
    mutationFn: (id: number) => api.deleteLog(id),
    onSuccess: () => {
      hapticNotification("success");
      setDeleting(null);
      invalidateDiary(qc);
    },
    onError: (err) => toastError(err, "Не удалось удалить"),
  });

  const repeatMutation = useMutation({
    mutationFn: (log: FoodLog) => api.repeatLog(log.id),
    onSuccess: (_res, log) => {
      hapticNotification("success");
      toast(`Повторено: ${log.foodName}`);
      invalidateDiary(qc);
    },
    onError: () => {
      hapticNotification("error");
      toast("Не удалось повторить");
    },
  });

  const favMutation = useMutation({
    mutationFn: (log: FoodLog) =>
      api.createFavorite({
        title: log.foodName,
        items: [
          {
            foodName: log.foodName,
            calories: log.calories,
            protein: log.protein,
            fat: log.fat,
            carbs: log.carbs,
            weight: log.weight,
          },
        ],
      }),
    onSuccess: (_res, log) => {
      hapticNotification("success");
      toast(`В избранном: ${log.foodName}`);
      // The favorites list isn't mounted on some screens, so force a refetch of
      // inactive queries too — otherwise the list stays stale until re-entry.
      qc.invalidateQueries({ queryKey: ["favorites"], refetchType: "all" });
    },
    onError: () => {
      hapticNotification("error");
      toast("Не удалось сохранить");
    },
  });

  // Стрелки листают неделю; выбранный день сдвигается на тот же день недели.
  const shiftWeek = (dir: -1 | 1) => {
    hapticSelection();
    const end = addDaysISO(weekEnd, dir * 7);
    if (end > today) return;
    setWeekEnd(end);
    setDate((cur) => {
      const next = addDaysISO(cur, dir * 7);
      return next > today ? today : next;
    });
  };

  const jumpTo = (d: string) => {
    if (!ISO_RE.test(d) || d > today) return;
    setDate(d);
    setWeekEnd(weekEndFor(d, today));
  };

  const goal = data?.goals.calories ?? me.data?.goals.calories ?? null;

  return (
    <div>
      <PageHeader
        title="История"
        subtitle={
          // Нативный выбор даты поверх подписи — для прыжка на далёкий день.
          <label className="relative">
            {formatDateRange(addDaysISO(weekEnd, -6), weekEnd)}
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && jumpTo(e.target.value)}
              className="absolute inset-0 opacity-0"
              aria-label="Выбрать дату"
            />
          </label>
        }
      />

      <div className="flex items-center gap-1 px-1.5 pb-4">
        <IconButton onClick={() => shiftWeek(-1)} aria-label="Предыдущая неделя">
          <ChevronLeft className="h-5 w-5" />
        </IconButton>
        <div className="flex-1">
          {week.data ? (
            <WeekBars days={week.data.days} goal={goal} today={today} selected={date} onSelect={setDate} />
          ) : (
            <Skeleton className="h-[60px] w-full rounded-[10px]" />
          )}
        </div>
        <IconButton
          onClick={() => shiftWeek(1)}
          disabled={weekEnd >= today}
          aria-label="Следующая неделя"
        >
          <ChevronRight className="h-5 w-5" />
        </IconButton>
      </div>

      <div className="px-4">
        {isError ? (
          <ErrorScreen error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <div className="space-y-3.5">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <DaySummary date={date} data={data} />
            {data.foodLogs.length === 0 ? (
              <Card className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <Utensils className="h-7 w-7" />
                <p className="text-sm">В этот день ничего не записано</p>
              </Card>
            ) : (
              MEAL_ORDER.map((meal) => {
                const logs = data.foodLogs.filter((l) => l.mealType === meal);
                if (logs.length === 0) return null;
                const subtotal = round(logs.reduce((s, l) => s + l.calories, 0));
                return (
                  <div key={meal}>
                    <SectionHeading title={MEAL_LABELS[meal]} right={`${subtotal} ккал`} />
                    <Card className="mb-3.5 px-[18px] py-1.5">
                      {logs.map((log) => {
                        const isFavorited = hasFavoriteTitle(ownFavTitles, log.foodName);
                        const repeating = repeatMutation.isPending && repeatMutation.variables?.id === log.id;
                        return (
                          <div
                            key={log.id}
                            className="flex items-center gap-2 border-border py-2 [&:not(:first-child)]:border-t"
                          >
                            <div className="min-w-0 flex-1">
                              <b className="block truncate text-[15px] font-medium">{log.foodName}</b>
                              <span className="text-xs text-muted-foreground">
                                {log.weight} г · Б {round(log.protein)} · Ж {round(log.fat)} · У {round(log.carbs)}
                              </span>
                            </div>
                            <div className="text-sm font-semibold">{round(log.calories)}</div>
                            <IconButton
                              onClick={() => repeatMutation.mutate(log)}
                              disabled={repeating}
                              aria-label="Повторить на сегодня"
                              title="Повторить на сегодня"
                            >
                              <RotateCw className={`h-4 w-4 ${repeating ? "animate-spin" : ""}`} />
                            </IconButton>
                            <IconButton
                              active={isFavorited}
                              onClick={() => {
                                if (isFavorited) {
                                  toast("Уже в избранном");
                                  return;
                                }
                                favMutation.mutate(log);
                              }}
                              aria-label={isFavorited ? "Уже в избранном" : "В избранное"}
                              title={isFavorited ? "Уже в избранном" : "В избранное"}
                            >
                              <Star className={`h-4 w-4 ${isFavorited ? "fill-current" : ""}`} />
                            </IconButton>
                            <IconButton
                              onClick={() => {
                                hapticSelection();
                                setMenuFor(log);
                              }}
                              aria-label={`Ещё: ${log.foodName}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </IconButton>
                          </div>
                        );
                      })}
                    </Card>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      <Modal open={!!menuFor} onOpenChange={(o) => !o && setMenuFor(null)} title={menuFor?.foodName}>
        <Card className="divide-y divide-border">
          <SheetAction
            icon={<Pencil className="h-4 w-4" />}
            label="Редактировать"
            onClick={() => {
              setEditing(menuFor);
              setMenuFor(null);
            }}
          />
          <SheetAction
            icon={<Trash2 className="h-4 w-4" />}
            label="Удалить"
            destructive
            onClick={() => {
              setDeleting(menuFor);
              setMenuFor(null);
            }}
          />
        </Card>
      </Modal>

      <EditFoodModal
        log={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidateDiary(qc);
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

/** Карточка дня: дата, калории из цели с бейджем, плашки БЖУ. */
function DaySummary({ date, data }: { date: string; data: DayResponse }) {
  const eaten = round(data.totals.calories);
  const goal = data.goals.calories;
  const over = goal ? eaten - goal : 0;
  return (
    <Card className="mb-3.5 p-[18px]">
      <b className="text-lg">{formatDateLong(date)}</b>
      <div className="mt-2 flex items-baseline gap-2">
        <b className="text-[28px] leading-none">{eaten}</b>
        <span className="text-muted-foreground">{goal ? `из ${goal} ккал` : "ккал"}</span>
        {goal && eaten > 0 ? (
          over > 0 ? (
            <span className="ml-auto rounded-xl bg-bad-soft px-2.5 py-[5px] text-[13px] font-semibold text-destructive">
              +{over}
            </span>
          ) : (
            <span className="ml-auto rounded-xl bg-ok-soft px-2.5 py-[5px] text-[13px] font-semibold text-ok">
              ✓ в норме
            </span>
          )
        ) : null}
      </div>
      <MacroPills className="mt-3" values={data.totals} note={() => null} />
    </Card>
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
    onError: (err) => toastError(err, "Не удалось сохранить"),
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
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Калории">
          <Input type="number" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />
        </Field>
        <Field label="Белки, г" labelClassName="text-prot-fg">
          <Input type="number" inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </Field>
        <Field label="Жиры, г" labelClassName="text-fat-fg">
          <Input type="number" inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} />
        </Field>
        <Field label="Углеводы, г" labelClassName="text-carb-fg">
          <Input type="number" inputMode="numeric" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
        </Field>
      </div>
      <Button className="mt-2 w-full" disabled={mutation.isPending} onClick={save}>
        Сохранить
      </Button>
    </div>
  );
}
