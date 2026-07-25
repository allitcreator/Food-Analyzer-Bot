import { useEffect, useState } from "react";

/**
 * Minimal, dependency-free toast: call `toast("...")` from anywhere and mount
 * a single <Toaster/> near the app root. Auto-dismisses after a short delay.
 */
interface ToastItem {
  id: number;
  message: string;
}

let listeners: Array<(t: ToastItem) => void> = [];
let counter = 0;

export function toast(message: string) {
  const item: ToastItem = { id: ++counter, message };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => {
        setItems((cur) => cur.filter((x) => x.id !== t.id));
      }, 2200);
    };
    listeners.push(onToast);
    return () => {
      listeners = listeners.filter((l) => l !== onToast);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto max-w-xs rounded-xl bg-foreground/90 px-4 py-2.5 text-center text-sm font-medium text-background shadow-lg data-[state=open]:animate-in animate-in fade-in slide-in-from-bottom-2"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
