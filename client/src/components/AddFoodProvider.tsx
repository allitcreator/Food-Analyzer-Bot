/**
 * Состояние шторки «Добавить еду» поднято в App: её открывают FAB «+» на любом
 * экране и «+ Добавить ужин» на «Сегодня» (с предвыбранным приёмом).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { MealType } from "@/lib/types";
import { AddFoodModal } from "@/components/AddFoodModal";

interface AddFoodOptions {
  /** Предвыбранный приём; без него — по времени суток в таймзоне профиля. */
  mealType?: MealType;
}

interface AddFoodApi {
  open: (opts?: AddFoodOptions) => void;
}

const AddFoodContext = createContext<AddFoodApi | null>(null);

export function AddFoodProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mealType, setMealType] = useState<MealType | undefined>();
  // Новый ключ на каждое открытие — шторка стартует с чистого состояния.
  const [session, setSession] = useState(0);

  const openSheet = useCallback((opts?: AddFoodOptions) => {
    setMealType(opts?.mealType);
    setSession((s) => s + 1);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ open: openSheet }), [openSheet]);

  return (
    <AddFoodContext.Provider value={value}>
      {children}
      <AddFoodModal key={session} open={open} onOpenChange={setOpen} initialMealType={mealType} />
    </AddFoodContext.Provider>
  );
}

export function useAddFood(): AddFoodApi {
  const ctx = useContext(AddFoodContext);
  if (!ctx) throw new Error("useAddFood вне AddFoodProvider");
  return ctx;
}
