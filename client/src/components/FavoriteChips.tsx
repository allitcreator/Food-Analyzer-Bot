import type { Favorite } from "@/lib/types";
import { round } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Сумма калорий избранного по всем позициям. */
export function favoriteCalories(fav: Favorite): number {
  return round(fav.items.reduce((s, it) => s + (it.calories ?? 0), 0));
}

/** Лента чипов «+ Овсянка 310»: тап записывает избранное. */
export function FavoriteChips({
  favorites,
  onPick,
  disabled,
  className,
}: {
  favorites: Favorite[];
  onPick: (fav: Favorite) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1", className)}>
      {favorites.map((fav) => (
        <button
          key={fav.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(fav)}
          className="max-w-[220px] shrink-0 truncate rounded-2xl bg-card px-3.5 py-[9px] text-sm shadow-soft active:scale-[0.97] disabled:opacity-60"
          title={fav.title}
          aria-label={`Записать ${fav.title}`}
        >
          <span className="font-bold text-primary">+ </span>
          {fav.title}
          <small className="ml-1 text-muted-foreground">{favoriteCalories(fav)}</small>
        </button>
      ))}
    </div>
  );
}
