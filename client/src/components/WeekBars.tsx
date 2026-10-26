import type { WeekDayStat } from "@/lib/types";
import { weekdayShort, formatDateHuman, round } from "@/lib/format";
import { weekBarHeight, weekBarTone, WEEK_TONE_BG } from "@/lib/week-bars";
import { hapticSelection } from "@/lib/telegram";
import { cn } from "@/lib/utils";

/**
 * Неделя столбиками («Сегодня», «История»): цвет — по доле от цели калорий,
 * выбранный день обведён акцентом. Тап по дню — `onSelect(date)`.
 */
export function WeekBars({
  days,
  goal,
  today,
  selected,
  onSelect,
  className,
}: {
  days: WeekDayStat[];
  goal: number | null;
  today: string;
  selected?: string;
  onSelect?: (date: string) => void;
  className?: string;
}) {
  const weekMax = Math.max(0, ...days.map((d) => d.calories));
  return (
    <div className={cn("grid grid-cols-7 gap-1.5", className)}>
      {days.map((d) => {
        const tone = weekBarTone(d.calories, goal, d.date === today);
        const h = weekBarHeight(d.calories, goal, weekMax);
        const on = d.date === selected;
        return (
          <button
            key={d.date}
            type="button"
            onClick={() => {
              hapticSelection();
              onSelect?.(d.date);
            }}
            aria-label={`${formatDateHuman(d.date)}: ${round(d.calories)} ккал`}
            aria-pressed={on}
            className={cn(
              "text-center text-[11px]",
              on ? "font-bold text-foreground" : "text-muted-foreground",
            )}
          >
            <i
              className={cn(
                "relative mb-1 block h-11 overflow-hidden rounded-[10px] bg-fill",
                on && "outline outline-2 outline-offset-1 outline-primary",
              )}
            >
              <span
                className={cn("absolute inset-x-0 bottom-0", WEEK_TONE_BG[tone])}
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            </i>
            {weekdayShort(d.date)}
          </button>
        );
      })}
    </div>
  );
}
