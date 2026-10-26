/**
 * Можно ли админу применить действие к выбранному пользователю.
 *
 * Правила одни для всех кнопок `admin_*`:
 * - главного администратора (ADMIN_TELEGRAM_ID) не трогает никто;
 * - себя нельзя удалить, заблокировать, разжаловать и отклонить;
 * - «отклонить» удаляет пользователя, поэтому оно только для ещё не одобренных
 *   заявок, а не для действующих пользователей.
 */
export type AdminAction = "approve" | "reject" | "delete" | "block" | "unblock" | "makeadmin" | "removeadmin";

export type AdminTargetCheck = { ok: true } | { ok: false; reason: string };

const SELF_FORBIDDEN: ReadonlySet<AdminAction> = new Set(["reject", "delete", "block", "removeadmin"]);

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return x !== "" && x === y;
}

export function checkAdminTarget(
  action: AdminAction,
  actor: { telegramId: string | null | undefined },
  target: { telegramId: string | null | undefined; isApproved?: boolean | null },
  mainAdminTelegramId: string | null | undefined,
): AdminTargetCheck {
  if (sameId(target.telegramId, mainAdminTelegramId)) {
    return { ok: false, reason: "Нельзя менять главного администратора" };
  }
  if (SELF_FORBIDDEN.has(action) && sameId(target.telegramId, actor.telegramId)) {
    return { ok: false, reason: "Нельзя применить это действие к себе" };
  }
  if (action === "reject" && target.isApproved) {
    return { ok: false, reason: "Пользователь уже одобрен — отклонить нельзя" };
  }
  return { ok: true };
}
