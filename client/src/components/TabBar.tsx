import { Link, useLocation } from "wouter";
import { Home, CalendarDays, Star, TrendingUp, User, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticImpact, hapticSelection } from "@/lib/telegram";
import { useAddFood } from "@/components/AddFoodProvider";

const TABS = [
  { path: "/", label: "Сегодня", icon: Home },
  { path: "/history", label: "История", icon: CalendarDays },
  { path: "/favorites", label: "Избранное", icon: Star },
  { path: "/trends", label: "Тренды", icon: TrendingUp },
  { path: "/profile", label: "Профиль", icon: User },
];

export function TabBar() {
  const [location] = useLocation();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-xl rounded-t-[26px] bg-card pb-[calc(8px+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-4px_16px_rgba(120,70,30,.06)]">
      <div className="flex items-stretch justify-around">
        {TABS.map(({ path, label, icon: Icon }) => {
          const active = location === path;
          return (
            <Link
              key={path}
              href={path}
              onClick={() => hapticSelection()}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-[3px] text-[10px] font-semibold transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-[23px] w-[23px]" strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * «+» над вкладкой «Профиль» на всех экранах: открывает «Добавить еду».
 * Центр кнопки совпадает с центром пятой вкладки (90% ширины таб-бара).
 */
export function AddFoodFab() {
  const addFood = useAddFood();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-xl">
      <button
        type="button"
        onClick={() => {
          hapticImpact("medium");
          addFood.open();
        }}
        className="pointer-events-auto absolute bottom-0 right-[calc(10%-28px)] flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_20px_hsl(var(--primary)/.45)] active:scale-95"
        aria-label="Добавить еду"
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} />
      </button>
    </div>
  );
}
