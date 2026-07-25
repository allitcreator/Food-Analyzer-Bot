import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplet, Flame, Dumbbell, Star, Pencil, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import type { DayResponse, Favorite } from "@/lib/types";
import { round } from "@/lib/format";
import { hapticImpact, hapticNotification } from "@/lib/telegram";
import { crumb } from "@/lib/debug";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Ring, MacroRing } from "@/components/Ring";
import { Skeleton } from "@/components/ui/Skeleton";
import { MealGroups } from "@/components/MealGroups";
import { ErrorScreen } from "@/components/StateScreens";
import { toast } from "@/components/ui/Toast";

export default function Today() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery<DayResponse>({
    queryKey: ["day", "today"],
    queryFn: () => api.day(),
  });

  const addWater = useMutation({
    mutationFn: (amount: number) => api.addWater(amount),
    onSuccess: () => {
      hapticNotification("success");
      qc.invalidateQueries({ queryKey: ["day", "today"] });
    },
  });

  if (isError) return <ErrorScreen error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader title="Сегодня" />
      <div className="space-y-5 px-4">
        {isLoading || !data ? (
          <TodaySkeleton />
        ) : (
          <>
            <CaloriesCard data={data} />
            <MacrosCard data={data} />
            <FavoritesCard />
            {data.energyBalance && <EnergyCard eb={data.energyBalance} />}
            <WaterCard
              total={data.waterTotal}
              onAdd={(a) => {
                hapticImpact("medium");
                addWater.mutate(a);
              }}
              pending={addWater.isPending}
            />
            {data.workouts.length > 0 && <WorkoutsCard workouts={data.workouts} />}
            <MealGroups logs={data.foodLogs} />
          </>
        )}
      </div>
    </div>
  );
}

function CaloriesCard({ data }: { data: DayResponse }) {
  const eaten = round(data.totals.calories);
  const goal = data.goals.calories;
  const burned = data.workouts.reduce((s, w) => s + w.caloriesBurned, 0);
  const remaining = goal ? goal - eaten : null;
  const progress = goal ? eaten / goal : 0;

  return (
    <Card>
      <CardContent className="flex flex-col items-center pt-6">
        <Ring progress={progress} size={210} stroke={18} colorVar="--chart-1">
          <span className="text-4xl font-bold leading-none">{eaten}</span>
          <span className="mt-1 text-sm text-muted-foreground">
            {goal ? `из ${goal} ккал` : "ккал"}
          </span>
          {remaining !== null && (
            <span
              className={`mt-1 text-xs font-medium ${
                remaining < 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {remaining >= 0 ? `осталось ${remaining}` : `превышение ${-remaining}`}
            </span>
          )}
        </Ring>
        {burned > 0 && (
          <div className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Flame className="h-4 w-4 text-chart-3" />
            Сожжено тренировками: {round(burned)} ккал
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MacrosCard({ data }: { data: DayResponse }) {
  return (
    <Card>
      <CardContent className="flex justify-around pt-4">
        <MacroRing label="Белки" value={round(data.totals.protein)} goal={data.goals.protein} colorVar="--chart-2" />
        <MacroRing label="Жиры" value={round(data.totals.fat)} goal={data.goals.fat} colorVar="--chart-3" />
        <MacroRing label="Углеводы" value={round(data.totals.carbs)} goal={data.goals.carbs} colorVar="--chart-4" />
      </CardContent>
    </Card>
  );
}

/** Horizontal row of saved-favorite chips: tap to log, edit mode to delete. */
function FavoritesCard() {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);

  const { data } = useQuery({
    queryKey: ["favorites"],
    queryFn: api.favorites,
  });

  const logMutation = useMutation({
    mutationFn: (fav: Favorite) => api.logFavorite(fav.id),
    onSuccess: (_res, fav) => {
      crumb("today-fav-log:success-enter");
      hapticNotification("success");
      crumb("today-fav-log:after-haptic");
      toast(`Записано: ${fav.title}`);
      crumb("today-fav-log:after-toast");
      qc.invalidateQueries({ queryKey: ["day"] });
      crumb("today-fav-log:after-invalidate");
      setTimeout(() => crumb("today-fav-log:alive+1s"), 1000);
      setTimeout(() => crumb("today-fav-log:alive+3s"), 3000);
    },
    onError: () => {
      crumb("today-fav-log:error");
      hapticNotification("error");
      toast("Не удалось записать");
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => api.deleteFavorite(id),
    onSuccess: () => {
      hapticImpact("medium");
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  const favorites = data?.favorites ?? [];
  if (favorites.length === 0) return null;
  const hasOwn = favorites.some((f) => f.isOwner);

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Star className="h-4 w-4 text-chart-3" /> Избранное
          </span>
          {hasOwn && (
            <button
              onClick={() => {
                hapticImpact("light");
                setEditMode((v) => !v);
              }}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label={editMode ? "Готово" : "Править"}
            >
              {editMode ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </button>
          )}
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {favorites.map((fav) => (
            <div key={fav.id} className="relative shrink-0">
              <button
                disabled={logMutation.isPending || editMode}
                onClick={() => {
                  hapticImpact("medium");
                  logMutation.mutate(fav);
                }}
                className="max-w-[160px] truncate rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground active:scale-[0.97] disabled:opacity-60"
                title={fav.title}
              >
                {fav.title}
              </button>
              {editMode && fav.isOwner && (
                <button
                  onClick={() => delMutation.mutate(fav.id)}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                  aria-label={`Удалить ${fav.title}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EnergyCard({ eb }: { eb: NonNullable<DayResponse["energyBalance"]> }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground">Энергобаланс</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              eb.isDeficit
                ? "bg-chart-2/15 text-chart-2"
                : "bg-destructive/15 text-destructive"
            }`}
          >
            {eb.isDeficit ? "Дефицит" : "Профицит"} {Math.abs(round(eb.balance))} ккал
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="BMR" value={round(eb.bmr)} />
          <Stat label="TDEE" value={round(eb.tdee)} />
          <Stat label="Съедено" value={round(eb.eaten)} />
        </div>
        {eb.burnedFromActivity > 0 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Сожжено на тренировках: {round(eb.burnedFromActivity)} ккал
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/50 py-2">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
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
  const glasses = Math.min(8, Math.round(total / 250));
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Droplet className="h-4 w-4 text-chart-1" /> Вода
          </span>
          <span className="text-sm font-semibold">{total} мл</span>
        </div>
        <div className="mb-3 flex gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`h-2 flex-1 rounded-full ${i < glasses ? "bg-chart-1" : "bg-muted"}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            disabled={pending}
            onClick={() => onAdd(250)}
            className="flex-1 rounded-xl bg-secondary py-2.5 text-sm font-medium text-secondary-foreground active:scale-[0.98] disabled:opacity-50"
          >
            +250 мл
          </button>
          <button
            disabled={pending}
            onClick={() => onAdd(500)}
            className="flex-1 rounded-xl bg-secondary py-2.5 text-sm font-medium text-secondary-foreground active:scale-[0.98] disabled:opacity-50"
          >
            +500 мл
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkoutsCard({ workouts }: { workouts: DayResponse["workouts"] }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Dumbbell className="h-4 w-4 text-chart-5" /> Тренировки
        </div>
        <div className="divide-y divide-card-border">
          {workouts.map((w) => (
            <div key={w.id} className="flex items-center justify-between py-2">
              <span className="text-[15px]">{w.description}</span>
              <span className="text-sm text-muted-foreground">−{round(w.caloriesBurned)} ккал</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TodaySkeleton() {
  return (
    <>
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </>
  );
}
