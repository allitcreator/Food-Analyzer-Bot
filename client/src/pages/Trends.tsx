import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Flame, Scale } from "lucide-react";
import { api } from "@/lib/api";
import type { MeResponse, StatsResponse, WeightResponse } from "@/lib/types";
import { formatDateShort, round } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Segmented } from "@/components/ui/Segmented";
import { ErrorScreen } from "@/components/StateScreens";

type Range = "week" | "month";

export default function Trends() {
  const [range, setRange] = useState<Range>("week");

  const me = useQuery<MeResponse>({ queryKey: ["me"], queryFn: api.me });
  const stats = useQuery<StatsResponse>({
    queryKey: ["stats", range],
    queryFn: () => api.stats(range),
  });
  const weight = useQuery<WeightResponse>({ queryKey: ["weight"], queryFn: () => api.weight() });

  const goal = me.data?.goals.calories ?? null;

  return (
    <div>
      <PageHeader title="Тренды" />
      <div className="space-y-4 px-4">
        {stats.data && <StreakCard streak={stats.data.streak} />}

        <Card>
          <CardContent className="pt-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground">Калории</span>
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
              <Skeleton className="h-52 w-full rounded-xl" />
            ) : (
              <CaloriesChart data={stats.data} goal={goal} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Scale className="h-4 w-4 text-chart-2" /> Вес
            </div>
            {weight.isLoading || !weight.data ? (
              <Skeleton className="h-52 w-full rounded-xl" />
            ) : weight.data.logs.length < 2 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Мало данных. Отправьте вес боту, чтобы увидеть график.
              </p>
            ) : (
              <WeightChart data={weight.data} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StreakCard({ streak }: { streak: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-4">
        <Flame className="h-9 w-9 text-chart-3" />
        <div>
          <div className="text-2xl font-bold leading-none">{streak} дней</div>
          <div className="mt-1 text-xs text-muted-foreground">Серия ведения дневника</div>
        </div>
      </CardContent>
    </Card>
  );
}

function CaloriesChart({ data, goal }: { data: StatsResponse; goal: number | null }) {
  const rows =
    data.range === "week"
      ? data.days.map((d) => ({ label: d.dayLabel, calories: round(d.calories) }))
      : data.weeks.map((w) => ({ label: w.weekLabel, calories: round(w.calories) }));

  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 12,
            fontSize: 12,
            color: "hsl(var(--popover-foreground))",
          }}
          formatter={(v: number) => [`${v} ккал`, ""]}
        />
        {goal && <ReferenceLine y={goal} stroke="hsl(var(--chart-3))" strokeDasharray="4 4" />}
        <Bar dataKey="calories" radius={[6, 6, 0, 0]}>
          {rows.map((r, i) => (
            <Cell
              key={i}
              fill={goal && r.calories > goal ? "hsl(var(--chart-5))" : "hsl(var(--chart-1))"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function WeightChart({ data }: { data: WeightResponse }) {
  const rows = data.logs
    .slice()
    .reverse()
    .map((l) => ({
      label: l.date ? formatDateShort(l.date.slice(0, 10)) : "",
      weight: Math.round(l.weight * 10) / 10,
    }));

  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          domain={["dataMin - 1", "dataMax + 1"]}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 12,
            fontSize: 12,
            color: "hsl(var(--popover-foreground))",
          }}
          formatter={(v: number) => [`${v} кг`, ""]}
        />
        <Line
          type="monotone"
          dataKey="weight"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: "hsl(var(--chart-2))" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
