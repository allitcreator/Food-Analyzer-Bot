import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DayResponse, Favorite, FoodLog, MealType, MeResponse, WeekStatsResponse } from "@/lib/types";
import { formatDayTitle, MEAL_LABELS, MEAL_ORDER, round } from "@/lib/format";
import { todayInTimeZone } from "@/lib/date-tz";
import { averageCalories, withoutDay } from "@/lib/stats-summary";
import { proteinTip } from "@/lib/protein-tip";
import { invalidateDiary } from "@/lib/invalidate";
import { hapticImpact, hapticNotification, hapticSelection } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Card, SectionHeading } from "@/components/ui/Card";
import { Ring } from "@/components/Ring";
import { WeekBars } from "@/components/WeekBars";
import { MacroPills } from "@/components/MacroPills";
import { FavoriteChips } from "@/components/FavoriteChips";
import { useAddFood } from "@/components/AddFoodProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorScreen } from "@/components/StateScreens";
import { toast, toastError } from "@/components/ui/Toast";

/** Эмодзи и цвет круга приёма в «Мой день». */
const MEAL_PLATES: Record<MealType, { emoji: string; className: string }> = {
  breakfast: { emoji: "🥣", className: "bg-fat-bg" },
  lunch: { emoji: "🍗", className: "bg-prot-bg" },
  dinner: { emoji: "🍲", className: "bg-bad-soft" },
  snack: { emoji: "🍓", className: "bg-carb-bg" },
};

/** Вода: 8 капель по 250 мл. */
const WATER_DROPS = 8;
const WATER_DROP_ML = 250;

export default function Today() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const me = useQuery<MeResponse>({ queryKey: ["me"], queryFn: api.me });
  const { data, isLoading, isError, error, refetch } = useQuery<DayResponse>({
    queryKey: ["day", "today"],
    queryFn: () => api.day(),
  });
  const week = useQuery({
    queryKey: ["stats", "week"],
    queryFn: () => api.stats("week") as Promise<WeekStatsResponse>,
  });

  const addWater = useMutation({
    mutationFn: (amount: number) => api.addWater(amount),
    onSuccess: () => {
      hapticNotification("success");
      invalidateDiary(qc);
    },
    onError: (err) => toastError(err, "Не удалось добавить воду"),
  });

  if (isError) return <ErrorScreen error={error} onRetry={() => refetch()} />;

  const today = data?.date ?? todayInTimeZone(me.data?.timezone);
  const days = week.data?.days ?? [];
  const weekAvg = averageCalories(withoutDay(days, today));

  return (
    <div>
      <PageHeader
        title={formatDayTitle(today)}
        subtitle={weekAvg !== null ? `ср. за неделю ${weekAvg}` : undefined}
      />
      <div className="px-4">
        {days.length > 0 ? (
          <WeekBars
            days={days}
            goal={data?.goals.calories ?? me.data?.goals.calories ?? null}
            today={today}
            selected={today}
            onSelect={(date) => navigate(`/history?date=${date}`)}
            className="pb-4"
          />
        ) : week.isLoading ? (
          <Skeleton className="mb-4 h-[60px] w-full rounded-[10px]" />
        ) : null}

        {isLoading || !data ? (
          <TodaySkeleton />
        ) : (
          <div className="space-y-3.5">
            <HeroCard data={data} />
            <TipCard data={data} me={me.data} />
            <QuickAdd />
            <div>
              <SectionHeading title="Мой день" />
              <DayCard data={data} />
            </div>
            <WaterCard
              total={data.waterTotal}
              onAdd={(a) => {
                hapticImpact("medium");
                addWater.mutate(a);
              }}
              pending={addWater.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Кольцо остатка, бейдж нормы, плашки БЖУ и строка энергобаланса. */
function HeroCard({ data }: { data: DayResponse }) {
  const eaten = round(data.totals.calories);
  const goal = data.goals.calories;
  const remaining = goal ? goal - eaten : null;
  const eb = data.energyBalance;

  return (
    <Card className="p-[18px]">
      <div className="flex items-center gap-4">
        <Ring progress={goal ? eaten / goal : 0} size={104} stroke={12} />
        <div className="min-w-0">
          {remaining !== null ? (
            <>
              <b className="block text-[30px] leading-tight">{Math.max(0, remaining)} ккал</b>
              <span className="text-sm text-muted-foreground">
                осталось · съедено {eaten} из {goal}
              </span>
              {remaining >= 0 ? (
                <div className="mt-2.5 flex w-fit items-center gap-1 rounded-xl bg-ok-soft px-2.5 py-[5px] text-[13px] font-semibold text-ok">
                  ✓ В пределах нормы
                </div>
              ) : (
                <div className="mt-2.5 flex w-fit items-center gap-1 rounded-xl bg-bad-soft px-2.5 py-[5px] text-[13px] font-semibold text-destructive">
                  Превышение {-remaining}
                </div>
              )}
            </>
          ) : (
            <>
              <b className="block text-[30px] leading-tight">{eaten} ккал</b>
              <span className="text-sm text-muted-foreground">съедено сегодня</span>
            </>
          )}
        </div>
      </div>

      <MacroPills
        className="mt-4"
        values={data.totals}
        goals={{ protein: data.goals.protein, fat: data.goals.fat, carbs: data.goals.carbs }}
        bars
      />

      {eb && (
        <div className="mt-3.5 flex justify-between border-t border-dashed border-border pt-3.5 text-[13px] text-muted-foreground">
          <div>
            Расход (TDEE)
            <b className="block text-[15px] text-foreground">{round(eb.tdee)}</b>
          </div>
          <div>
            Тренировки
            <b className="block text-[15px] text-foreground">
              {eb.burnedFromActivity > 0 ? `−${round(eb.burnedFromActivity)}` : 0}
            </b>
          </div>
          <div className="text-right">
            {eb.isDeficit ? "Дефицит" : "Профицит"}
            <b className={cn("block text-[15px]", eb.isDeficit ? "text-ok" : "text-destructive")}>
              {Math.abs(round(eb.balance))}
            </b>
          </div>
        </div>
      )}
    </Card>
  );
}

function TipCard({ data, me }: { data: DayResponse; me: MeResponse | undefined }) {
  const tip = proteinTip({
    protein: data.totals.protein,
    proteinGoal: data.goals.protein,
    calories: data.totals.calories,
    caloriesGoal: data.goals.calories,
    timezone: me?.timezone,
    mealLunchEnd: me?.mealLunchEnd,
  });
  if (!tip) return null;
  return (
    <div className="flex gap-2.5 rounded-[20px] bg-fat-bg px-4 py-3.5 text-sm leading-snug text-foreground">
      <span className="text-xl leading-none" aria-hidden>
        💡
      </span>
      <span>{tip}</span>
    </div>
  );
}

/** «Быстро добавить»: чипы избранного, тап — запись на сегодня. */
function QuickAdd() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["favorites"], queryFn: api.favorites });

  const logMutation = useMutation({
    mutationFn: (fav: Favorite) => api.logFavorite(fav.id),
    onSuccess: (_res, fav) => {
      hapticNotification("success");
      toast(`Записано: ${fav.title}`);
      invalidateDiary(qc);
    },
    onError: (err) => toastError(err, "Не удалось записать"),
  });

  const favorites = data?.favorites ?? [];
  if (favorites.length === 0) return null;

  return (
    <div>
      <SectionHeading title="Быстро добавить" />
      <FavoriteChips
        favorites={favorites}
        disabled={logMutation.isPending}
        onPick={(fav) => {
          hapticImpact("medium");
          logMutation.mutate(fav);
        }}
        className="pb-1.5"
      />
    </div>
  );
}

/** «Мой день»: все четыре приёма, тап по непустому раскрывает позиции. */
function DayCard({ data }: { data: DayResponse }) {
  const addFood = useAddFood();
  const [expanded, setExpanded] = useState<MealType | null>(null);

  return (
    <Card className="p-[18px]">
      {MEAL_ORDER.map((meal) => {
        const logs = data.foodLogs.filter((l) => l.mealType === meal);
        const plate = MEAL_PLATES[meal];
        const total = round(logs.reduce((s, l) => s + l.calories, 0));
        const open = expanded === meal;
        return (
          <MealRow key={meal} emoji={plate.emoji} plateClassName={plate.className}>
            {logs.length === 0 ? (
              <>
                <b className="block text-base">{MEAL_LABELS[meal]}</b>
                <button
                  type="button"
                  onClick={() => {
                    hapticImpact("light");
                    addFood.open({ mealType: meal });
                  }}
                  className="mt-1.5 text-sm font-semibold text-primary"
                >
                  + Добавить {MEAL_LABELS[meal].toLowerCase()}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    setExpanded(open ? null : meal);
                  }}
                  aria-expanded={open}
                  className="block w-full text-left"
                >
                  <b className="flex justify-between text-base">
                    {MEAL_LABELS[meal]} <span className="font-semibold text-primary">{total}</span>
                  </b>
                  {!open && (
                    <p className="mt-[3px] text-[13px] leading-snug text-muted-foreground">
                      {logs.map((l) => l.foodName).join(", ")}
                    </p>
                  )}
                </button>
                {open && <MealItems logs={logs} />}
              </>
            )}
          </MealRow>
        );
      })}
      {data.workouts.map((w) => (
        <MealRow key={`w${w.id}`} emoji="🏃" plateClassName="bg-accent-soft">
          <b className="flex justify-between gap-2 text-base">
            <span className="min-w-0 font-bold">{w.description}</span>
            <span className="shrink-0 font-semibold text-ok">−{round(w.caloriesBurned)}</span>
          </b>
        </MealRow>
      ))}
    </Card>
  );
}

function MealRow({
  emoji,
  plateClassName,
  children,
}: {
  emoji: string;
  plateClassName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 [&:not(:first-child)]:mt-4 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-dashed [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4">
      <div
        className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl", plateClassName)}
        aria-hidden
      >
        {emoji}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MealItems({ logs }: { logs: FoodLog[] }) {
  return (
    <div className="mt-1">
      {logs.map((log) => (
        <div key={log.id} className="flex items-center gap-2 border-border py-2 [&:not(:first-child)]:border-t">
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[15px] font-medium">{log.foodName}</b>
            <span className="text-xs text-muted-foreground">
              {log.weight} г · Б {round(log.protein)} · Ж {round(log.fat)} · У {round(log.carbs)}
            </span>
          </div>
          <div className="text-sm font-semibold">{round(log.calories)}</div>
        </div>
      ))}
    </div>
  );
}

function WaterCard({
  total,
  onAdd,
  pending,
}: {
  total: number;
  onAdd: (amount: number) => void;
  pending: boolean;
}) {
  const filled = Math.min(WATER_DROPS, Math.round(total / WATER_DROP_ML));
  return (
    <Card className="p-[18px]">
      <b className="text-base">💧 Вода</b>{" "}
      <span className="text-sm text-muted-foreground">
        {total} из {WATER_DROPS * WATER_DROP_ML} мл
      </span>
      <div className="mt-3 flex gap-1.5" aria-hidden>
        {Array.from({ length: WATER_DROPS }).map((_, i) => (
          <div key={i} className={cn("h-[34px] flex-1 rounded-[10px]", i < filled ? "bg-water" : "bg-water-soft")} />
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {[250, 500].map((amount) => (
          <button
            key={amount}
            disabled={pending}
            onClick={() => onAdd(amount)}
            className="flex-1 rounded-[14px] bg-water-soft py-2.5 text-sm font-semibold text-water active:scale-[0.98] disabled:opacity-50"
          >
            +{amount} мл
          </button>
        ))}
      </div>
    </Card>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-3.5">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
