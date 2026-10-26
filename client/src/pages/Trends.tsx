import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { MeResponse, StatsResponse, WeekStatsResponse, WeightResponse } from "@/lib/types";
import { formatDayMonthShort, formatDateHuman, round, weekdayShort } from "@/lib/format";
import { todayInTimeZone } from "@/lib/date-tz";
import { weekBarTone, WEEK_TONE_BG } from "@/lib/week-bars";
import { averageCalories, averageMacros, calorieExtremes, withoutDay } from "@/lib/stats-summary";
import { weightTrend, type WeightTrend } from "@/lib/weight-trend";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Segmented } from "@/components/ui/Segmented";
import { MacroPills } from "@/components/MacroPills";
import { ErrorScreen } from "@/components/StateScreens";

type Range = "week" | "month";

/** Строка графика калорий: день недели или неделя месяца. */
interface CalRow {
  key: string;
  label: string;
  /** Подпись в статах «мин., вс». */
  short: string;
  title: string;
  calories: number;
  isToday: boolean;
}

export default function Trends() {
  const [range, setRange] = useState<Range>("week");

  const me = useQuery<MeResponse>({ queryKey: ["me"], queryFn: api.me });
  const stats = useQuery<StatsResponse>({
    queryKey: ["stats", range],
    queryFn: () => api.stats(range),
  });
  // БЖУ «за неделю» и серия — всегда по неделе, даже когда график по месяцу.
  const week = useQuery({
    queryKey: ["stats", "week"],
    queryFn: () => api.stats("week") as Promise<WeekStatsResponse>,
  });
  const weight = useQuery<WeightResponse>({ queryKey: ["weight"], queryFn: () => api.weight() });

  const goals = me.data?.goals;
  const today = todayInTimeZone(me.data?.timezone);
  const streak = week.data?.streak ?? stats.data?.streak;
  const weekMacros = week.data ? averageMacros(withoutDay(week.data.days, today)) : null;

  return (
    <div>
      <PageHeader title="Тренды" />
      <div className="space-y-3.5 px-4">
        {streak !== undefined && <StreakCard streak={streak} />}

        <Card className="p-[18px]">
          <div className="flex items-center justify-between">
            <b className="text-[17px]">Калории</b>
            <Segmented<Range>
              value={range}
              onChange={setRange}
              className="w-40"
              options={[
                { value: "week", label: "Неделя" },
                { value: "month", label: "Месяц" },
              ]}
            />
          </div>
          {stats.isError ? (
            <ErrorScreen error={stats.error} onRetry={() => stats.refetch()} />
          ) : stats.isLoading || !stats.data ? (
            <Skeleton className="mt-4 h-[210px] w-full rounded-[14px]" />
          ) : (
            <CaloriesBlock rows={toRows(stats.data, today)} goal={goals?.calories ?? null} />
          )}
        </Card>

        <Card className="p-[18px]">
          {weight.isError ? (
            <ErrorScreen error={weight.error} onRetry={() => weight.refetch()} />
          ) : weight.isLoading || !weight.data ? (
            <Skeleton className="h-40 w-full rounded-[14px]" />
          ) : (
            <WeightBlock trend={weightTrend(weight.data.logs)} goal={me.data?.goal ?? null} />
          )}
        </Card>

        {weekMacros && (
          <Card className="p-[18px]">
            <b className="text-[17px]">БЖУ в среднем за неделю</b>
            <MacroPills
              className="mt-4"
              values={weekMacros}
              goals={goals ? { protein: goals.protein, fat: goals.fat, carbs: goals.carbs } : undefined}
              note={(_key, value, goal) => (goal ? `${Math.round((value / goal) * 100)}% цели` : null)}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function toRows(data: StatsResponse, today: string): CalRow[] {
  if (data.range === "week") {
    return data.days.map((d) => ({
      key: d.date,
      label: weekdayShort(d.date),
      short: weekdayShort(d.date).toLowerCase(),
      title: formatDateHuman(d.date),
      calories: round(d.calories),
      isToday: d.date === today,
    }));
  }
  return data.weeks.map((w) => ({
    key: w.weekLabel,
    label: w.weekLabel,
    short: w.weekLabel,
    title: `${w.weekLabel}, в среднем за день`,
    calories: round(w.calories),
    isToday: false,
  }));
}

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

function StreakCard({ streak }: { streak: number }) {
  return (
    <Card className="flex items-center gap-3.5 bg-accent-soft p-[18px]">
      <div className="text-[40px] leading-none" aria-hidden>
        🔥
      </div>
      <div>
        <b className="text-[26px] leading-tight">
          {streak} {dayWord(streak)}
        </b>
        <div className="text-[13px] text-muted-foreground">подряд ведёте дневник</div>
      </div>
    </Card>
  );
}

/** Высота области столбиков, px; подписи дней — ниже, ещё 20px. */
const PLOT_H = 124;
const LABEL_H = 20;

/** Столбики в цветах недели + пунктир цели, под ними среднее, минимум и максимум. */
function CaloriesBlock({ rows, goal }: { rows: CalRow[]; goal: number | null }) {
  const max = Math.max(goal ?? 0, ...rows.map((r) => r.calories));
  // Запас сверху, чтобы перебор был виден над линией цели.
  const scale = max > 0 ? max * 1.1 : 1;
  // Сегодняшний день не закончен — в статы его не берём, столбик остаётся.
  const finished = rows.filter((r) => !r.isToday);
  const avg = averageCalories(finished);
  const ext = calorieExtremes(finished);

  return (
    <>
      <div className="relative mt-4 flex h-[150px] items-end gap-2.5 pt-1.5">
        {goal ? (
          <div
            className="absolute inset-x-0 border-t-2 border-dashed border-primary/60"
            style={{ bottom: LABEL_H + (goal / scale) * PLOT_H }}
            aria-hidden
          >
            <span className="absolute -top-[18px] right-0 text-[11px] font-bold text-primary">{goal}</span>
          </div>
        ) : null}
        {rows.map((r) => {
          const tone = weekBarTone(r.calories, goal, r.isToday);
          return (
            <div
              key={r.key}
              className={cn(
                "flex h-full flex-1 flex-col items-center justify-end gap-1.5 text-[11px]",
                r.isToday ? "font-bold text-foreground" : "text-muted-foreground",
              )}
              title={`${r.title}: ${r.calories} ккал`}
            >
              <i
                className={cn(
                  "block w-full rounded-[10px_10px_6px_6px]",
                  tone === "empty" ? "bg-fill" : WEEK_TONE_BG[tone],
                )}
                style={{ height: tone === "empty" ? 4 : Math.max(4, (r.calories / scale) * PLOT_H) }}
              />
              <span className="whitespace-nowrap leading-[14px]">{r.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3.5 grid grid-cols-3 gap-2">
        <Stat value={avg} label="в среднем" />
        <Stat value={ext?.min.calories ?? null} label={ext ? `мин., ${ext.min.short}` : "мин."} />
        <Stat value={ext?.max.calories ?? null} label={ext ? `макс., ${ext.max.short}` : "макс."} />
      </div>
    </>
  );
}

function Stat({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="rounded-[14px] bg-fill p-2.5 text-center text-[11px] text-muted-foreground">
      <b className="mb-0.5 block text-[17px] text-foreground">{value ?? "—"}</b>
      {label}
    </div>
  );
}

const formatKg = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

function WeightBlock({ trend, goal }: { trend: WeightTrend | null; goal: string | null }) {
  // useId даёт ":r1:" — двоеточия в url(#…) ломаются в части WebView.
  const gradientId = `weight-fill-${useId().replace(/:/g, "")}`;
  if (!trend) {
    return (
      <>
        <b className="text-[17px]">Вес</b>
        <p className="py-8 text-center text-sm text-muted-foreground">
          Мало данных. Отправьте вес боту, чтобы увидеть график.
        </p>
      </>
    );
  }

  const { delta, points } = trend;
  // Зелёный бейдж, когда вес идёт в сторону цели; иначе нейтральный.
  const good = delta !== null && (goal === "gain" ? delta > 0 : delta < 0);
  const period = trend.monthWindow ? "за месяц" : "за период";
  const mid = points[Math.floor((points.length - 1) / 2)];

  return (
    <>
      <div className="flex items-baseline justify-between">
        <b className="text-[17px]">Вес</b>
        {delta !== null && (
          <span
            className={cn(
              "rounded-xl px-2.5 py-[5px] text-[13px] font-semibold",
              good ? "bg-ok-soft text-ok" : "bg-fill text-muted-foreground",
            )}
          >
            {delta === 0
              ? `без изменений ${period}`
              : `${delta > 0 ? "+" : "−"}${formatKg(Math.abs(delta))} кг ${period}`}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <b className="text-[28px] leading-none">{formatKg(trend.current)}</b>
        <span className="text-muted-foreground">кг</span>
      </div>
      {points.length < 2 ? (
        <p className="pt-4 text-center text-sm text-muted-foreground">
          Мало данных. Отправьте вес боту, чтобы увидеть график.
        </p>
      ) : (
        <>
          <div className="mt-1.5 h-[90px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                    <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "none",
                    borderRadius: 12,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  labelFormatter={(_l, payload) =>
                    payload?.[0] ? formatDayMonthShort(String(payload[0].payload.date)) : ""
                  }
                  formatter={(v: number) => [`${formatKg(v)} кг`, ""]}
                />
                <Area
                  type="monotone"
                  dataKey="weight"
                  stroke="hsl(var(--primary))"
                  strokeWidth={3}
                  fill={`url(#${gradientId})`}
                  dot={(props: { cx?: number; cy?: number; index?: number }) =>
                    props.index === points.length - 1 ? (
                      <circle key="last" cx={props.cx} cy={props.cy} r={5} fill="hsl(var(--primary))" />
                    ) : (
                      <g key={props.index} />
                    )
                  }
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{formatDayMonthShort(points[0].date)}</span>
            {points.length > 2 && <span>{formatDayMonthShort(mid.date)}</span>}
            <span>{formatDayMonthShort(points[points.length - 1].date)}</span>
          </div>
        </>
      )}
    </>
  );
}
