import { Link, useLocation } from "wouter";
import { Home, CalendarDays, TrendingUp, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/telegram";

const TABS = [
  { path: "/", label: "Сегодня", icon: Home },
  { path: "/history", label: "История", icon: CalendarDays },
  { path: "/trends", label: "Тренды", icon: TrendingUp },
  { path: "/profile", label: "Профиль", icon: User },
];

export function TabBar() {
  const [location] = useLocation();

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-card-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-stretch justify-around">
        {TABS.map(({ path, label, icon: Icon }) => {
          const active = location === path;
          return (
            <Link
              key={path}
              href={path}
              onClick={() => hapticSelection()}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
