import { Pencil, Trash2, Utensils } from "lucide-react";
import type { FoodLog } from "@/lib/types";
import { MEAL_LABELS, MEAL_ORDER, round } from "@/lib/format";
import { Card } from "@/components/ui/Card";

interface MealGroupsProps {
  logs: FoodLog[];
  onEdit?: (log: FoodLog) => void;
  onDelete?: (log: FoodLog) => void;
}

/** Food entries grouped by meal type with per-meal calorie subtotals. */
export function MealGroups({ logs, onEdit, onDelete }: MealGroupsProps) {
  if (logs.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
        <Utensils className="h-7 w-7" />
        <p className="text-sm">Записей о еде пока нет</p>
        <p className="text-xs">Добавьте приём пищи в чате бота</p>
      </Card>
    );
  }

  const byMeal = MEAL_ORDER.map((meal) => ({
    meal,
    items: logs.filter((l) => l.mealType === meal),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {byMeal.map(({ meal, items }) => {
        const subtotal = items.reduce((s, i) => s + i.calories, 0);
        return (
          <div key={meal}>
            <div className="mb-1.5 flex items-baseline justify-between px-1">
              <span className="text-sm font-semibold">{MEAL_LABELS[meal]}</span>
              <span className="text-xs text-muted-foreground">{round(subtotal)} ккал</span>
            </div>
            <Card className="divide-y divide-card-border">
              {items.map((log) => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{log.foodName}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.weight} г · {round(log.calories)} ккал · Б {round(log.protein)} · Ж{" "}
                      {round(log.fat)} · У {round(log.carbs)}
                    </p>
                  </div>
                  {onEdit && (
                    <button
                      onClick={() => onEdit(log)}
                      className="rounded-full p-2 text-muted-foreground hover:bg-secondary"
                      aria-label="Редактировать"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => onDelete(log)}
                      className="rounded-full p-2 text-destructive hover:bg-secondary"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
