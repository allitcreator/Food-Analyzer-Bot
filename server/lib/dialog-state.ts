/**
 * Диалоговые шаги бота (userStates: ввод числа, времени, шаги профиля) —
 * чистые правила выхода из шага.
 *
 * Раньше нечисловой ввод в числовом шаге отвечал «Введите число», а шаг
 * персистился навсегда: пользователь застревал, команды выполнялись, но
 * следующий текст снова ловился шагом. Теперь:
 *   • любая команда сбрасывает шаг и выполняется как обычно;
 *   • /cancel сбрасывает шаг сам (хендлер /cancel);
 *   • фото/голос/прочее без текста сбрасывают шаг и обрабатываются как еда;
 *   • шаг живёт не дольше DIALOG_STATE_TTL_MS, состояние без метки времени
 *     (застрявшее до этого изменения) считается истёкшим;
 *   • нечисловой текст в свежем шаге — шаг остаётся, бот переспрашивает с
 *     подсказкой CANCEL_HINT.
 */

export const DIALOG_STATE_TTL_MS = 30 * 60 * 1000;

export const CANCEL_HINT = "/cancel — отменить ввод";

export type DialogInputDecision =
  | "no_state"
  | "cancel_command"
  | "reset_command"
  | "reset_expired"
  | "reset_non_text"
  | "handle";

export function isDialogStateExpired(state: { at?: number }, nowMs: number): boolean {
  if (typeof state.at !== "number") return true;
  return nowMs - state.at > DIALOG_STATE_TTL_MS;
}

export function isCancelCommand(text: string | null | undefined): boolean {
  if (!text) return false;
  return /^\/cancel(@\w+)?$/.test(text.trim());
}

export function decideDialogInput(
  state: { at?: number } | undefined,
  msg: { text?: string },
  nowMs: number,
): DialogInputDecision {
  if (!state) return "no_state";
  const text = msg.text;
  if (text?.trim().startsWith("/")) {
    return isCancelCommand(text) ? "cancel_command" : "reset_command";
  }
  if (isDialogStateExpired(state, nowMs)) return "reset_expired";
  if (text === undefined) return "reset_non_text";
  return "handle";
}
