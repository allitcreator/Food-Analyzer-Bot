/**
 * ВРЕМЕННАЯ диагностика iOS-фриза Mini App.
 *
 * На iPhone (Telegram iOS) приложение «зависает намертво» сразу после успешной
 * мутации — исключений нет, главный поток фризится. Чтобы увидеть последний
 * живой шаг, клиент шлёт beacon-«крошки» на сервер до/после каждого шага
 * onSuccess. По логам сервера ([crumb] ...) видно, где всё встало.
 *
 * Удалить весь файл и его вызовы после расследования.
 */

// Тот же базовый префикс, что и в lib/api.ts — пути работают при базе /app/.
const BASE = "/api/app";

/** Шлёт «крошку» на сервер. Никогда не бросает — диагностика не должна ронять UI. */
export function crumb(name: string): void {
  try {
    const url = `${BASE}/crumb?e=${encodeURIComponent(name)}`;
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(url)
    ) {
      return;
    }
    // Фолбэк, если sendBeacon недоступен или не смог поставить запрос в очередь.
    void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    /* глотаем — диагностика не должна ничего ломать */
  }
}

/** Один раз вешает глобальные обработчики ошибок, шлющие крошку с текстом. */
export function installCrumbReporter(): void {
  try {
    window.addEventListener("error", (ev) => {
      const msg = String(ev?.message ?? ev?.error ?? "").slice(0, 200);
      crumb(`err:${msg}`);
    });
    window.addEventListener("unhandledrejection", (ev) => {
      const reason = (ev as PromiseRejectionEvent)?.reason;
      const msg = String(reason?.message ?? reason ?? "").slice(0, 200);
      crumb(`err:${msg}`);
    });
  } catch {
    /* глотаем */
  }
}
