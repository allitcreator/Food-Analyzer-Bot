import { round } from "@/lib/format";
import { cn } from "@/lib/utils";

type MacroKey = "protein" | "fat" | "carbs";

const MACROS: { key: MacroKey; label: string; className: string }[] = [
  { key: "protein", label: "Белки", className: "bg-prot-bg text-prot-fg" },
  { key: "fat", label: "Жиры", className: "bg-fat-bg text-fat-fg" },
  { key: "carbs", label: "Углеводы", className: "bg-carb-bg text-carb-fg" },
];

type Macros = Record<MacroKey, number>;
type MacroGoals = Record<MacroKey, number | null>;

/**
 * Три цветные плашки БЖУ. С `goals` — подпись «из N» и полоска прогресса;
 * `note` переопределяет подпись (например, «74% цели» в «Трендах»).
 */
export function MacroPills({
  values,
  goals,
  note,
  bars = false,
  className,
}: {
  values: Macros;
  goals?: MacroGoals;
  note?: (key: MacroKey, value: number, goal: number | null) => string | null;
  bars?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2.5", className)}>
      {MACROS.map(({ key, label, className: tone }) => {
        const value = round(values[key]);
        const goal = goals?.[key] ?? null;
        const sub = note ? note(key, value, goal) : goal ? `из ${goal}` : null;
        const pct = goal && goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
        return (
          <div key={key} className={cn("rounded-[18px] p-3", tone)}>
            <span className="text-xs font-semibold opacity-80">{label}</span>
            <b className="mt-0.5 block text-[19px] leading-tight">{value} г</b>
            {sub && <small className="text-xs opacity-75">{sub}</small>}
            {bars && goal ? (
              <div className="relative mt-2 h-1 overflow-hidden rounded-sm">
                <div className="absolute inset-0 bg-current opacity-[.18]" />
                <div className="absolute inset-y-0 left-0 rounded-sm bg-current" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
