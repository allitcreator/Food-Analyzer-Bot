/**
 * Чистые помощники обработчиков бота: обёртка от падения процесса, защита от
 * двойного тапа, проверка цели админских действий и округление правок по типу
 * колонки. Без бота, конфига и базы — те же функции вызывает server/bot.ts.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { safeHandler, handlerNameForPattern } from "../server/lib/safe-handler";
import { createInFlightGuard, takePending, restorePending } from "../server/lib/callback-guard";
import { checkAdminTarget } from "../server/lib/admin-target";
import { roundFoodLogField } from "../server/lib/food-log-fields";

describe("safeHandler", () => {
  test("синхронное исключение не пробрасывается и попадает в лог с именем хендлера", async () => {
    const lines: string[] = [];
    const wrapped = safeHandler("callback_query", () => {
      throw new Error("boom");
    }, { log: (l) => lines.push(l) });

    await assert.doesNotReject(async () => wrapped());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /callback_query/);
    assert.match(lines[0], /Error: boom/);
  });

  test("отклонённый промис не пробрасывается и попадает в лог", async () => {
    const lines: string[] = [];
    const wrapped = safeHandler("message", async () => {
      await Promise.resolve();
      throw Object.assign(new Error("db down"), { code: "57P01" });
    }, { log: (l) => lines.push(l) });

    await assert.doesNotReject(async () => wrapped());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /message/);
    assert.match(lines[0], /code=57P01/);
  });

  test("в лог не уходит объект ошибки целиком (тело запроса Telegram)", async () => {
    const lines: string[] = [];
    const err = Object.assign(new Error("ETELEGRAM: 400"), {
      response: { request: { form: { text: "секретный ужин" } } },
    });
    const wrapped = safeHandler("message", async () => { throw err; }, { log: (l) => lines.push(l) });
    await wrapped();
    assert.ok(!lines.join("\n").includes("секретный ужин"));
  });

  test("onError получает аргументы хендлера; его собственная ошибка тоже не пробрасывается", async () => {
    const lines: string[] = [];
    const seen: unknown[] = [];
    const wrapped = safeHandler("callback_query", async (_q: { id: string }) => {
      throw new Error("boom");
    }, {
      log: (l) => lines.push(l),
      onError: async (_err, q) => {
        seen.push(q.id);
        throw new Error("answer failed");
      },
    });

    await assert.doesNotReject(async () => wrapped({ id: "q1" }));
    assert.deepEqual(seen, ["q1"]);
    assert.equal(lines.length, 2);
  });

  test("успешный хендлер ничего не логирует и onError не зовёт", async () => {
    const lines: string[] = [];
    let called = false;
    const wrapped = safeHandler("tick", async () => {}, {
      log: (l) => lines.push(l),
      onError: () => { called = true; },
    });
    await wrapped();
    assert.equal(lines.length, 0);
    assert.equal(called, false);
  });

  test("handlerNameForPattern берёт имя команды из регулярки", () => {
    assert.equal(handlerNameForPattern(/^\/help(@\w+)?$/), "/help");
    assert.equal(handlerNameForPattern(/^\/export(@\w+)?\s+(\d{2})$/), "/export");
    assert.equal(handlerNameForPattern(/foo/), "onText");
  });
});

describe("createInFlightGuard", () => {
  test("второй захват того же ключа отклоняется, пока первый не отпущен", () => {
    const guard = createInFlightGuard();
    assert.equal(guard.tryAcquire("1:hist_rep_5"), true);
    assert.equal(guard.tryAcquire("1:hist_rep_5"), false);
    assert.equal(guard.tryAcquire("1:hist_rep_6"), true, "другой ключ не блокируется");
    assert.equal(guard.tryAcquire("2:hist_rep_5"), true, "другой пользователь не блокируется");
    guard.release("1:hist_rep_5");
    assert.equal(guard.tryAcquire("1:hist_rep_5"), true, "после release можно снова");
  });

  test("run: параллельный вызов с тем же ключом не выполняется", async () => {
    const guard = createInFlightGuard();
    let runs = 0;
    let unblock!: () => void;
    const gate = new Promise<void>((r) => { unblock = r; });

    const first = guard.run("k", async () => { runs++; await gate; return "done"; });
    const second = await guard.run("k", async () => { runs++; return "dup"; });
    assert.deepEqual(second, { ran: false });

    unblock();
    assert.deepEqual(await first, { ran: true, value: "done" });
    assert.equal(runs, 1);
  });

  test("run отпускает ключ и после исключения", async () => {
    const guard = createInFlightGuard();
    await assert.rejects(guard.run("k", async () => { throw new Error("x"); }));
    assert.equal(guard.tryAcquire("k"), true);
  });
});

describe("takePending / restorePending", () => {
  test("take снимает запись сразу, второй take видит пусто", () => {
    const store: Record<string, { n: number } | undefined> = { u1: { n: 1 } };
    assert.deepEqual(takePending(store, "u1"), { n: 1 });
    assert.equal("u1" in store, false);
    assert.equal(takePending(store, "u1"), undefined);
  });

  test("restore возвращает запись, если место свободно", () => {
    const store: Record<string, { n: number }> = {};
    restorePending(store, "u1", { n: 1 });
    assert.deepEqual(store.u1, { n: 1 });
  });

  test("restore не затирает новую запись, появившуюся за время сохранения", () => {
    const store: Record<string, { n: number }> = { u1: { n: 2 } };
    restorePending(store, "u1", { n: 1 });
    assert.deepEqual(store.u1, { n: 2 });
  });
});

describe("checkAdminTarget", () => {
  const MAIN = "100";
  const actor = { telegramId: "200" };
  const regular = { telegramId: "300", isApproved: true };
  const pendingUser = { telegramId: "301", isApproved: false };
  const mainAdmin = { telegramId: " 100 ", isApproved: true };

  test("главного администратора нельзя трогать ни одним действием", () => {
    for (const action of ["approve", "reject", "delete", "block", "unblock", "makeadmin", "removeadmin"] as const) {
      const r = checkAdminTarget(action, actor, mainAdmin, MAIN);
      assert.equal(r.ok, false, action);
    }
  });

  test("себя нельзя удалить, заблокировать, разжаловать и отклонить", () => {
    const self = { telegramId: "200", isApproved: false };
    for (const action of ["delete", "block", "removeadmin", "reject"] as const) {
      assert.equal(checkAdminTarget(action, actor, self, MAIN).ok, false, action);
    }
  });

  test("reject — только для ещё не одобренных", () => {
    assert.equal(checkAdminTarget("reject", actor, regular, MAIN).ok, false);
    assert.equal(checkAdminTarget("reject", actor, pendingUser, MAIN).ok, true);
  });

  test("обычные действия над обычным пользователем разрешены", () => {
    for (const action of ["approve", "delete", "block", "unblock", "makeadmin", "removeadmin"] as const) {
      assert.equal(checkAdminTarget(action, actor, regular, MAIN).ok, true, action);
    }
  });

  test("без настроенного главного админа проверка по нему не срабатывает", () => {
    assert.equal(checkAdminTarget("delete", actor, { telegramId: "", isApproved: true }, "").ok, true);
    assert.equal(checkAdminTarget("delete", actor, regular, undefined).ok, true);
  });

  test("отказ несёт текст для пользователя", () => {
    const r = checkAdminTarget("delete", actor, mainAdmin, MAIN);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.reason.length > 0);
  });
});

describe("roundFoodLogField", () => {
  test("integer-колонки округляются до целого", () => {
    for (const f of ["calories", "protein", "fat", "carbs", "weight"]) {
      assert.equal(roundFoodLogField(f, 12.6), 13, f);
      assert.ok(Number.isInteger(roundFoodLogField(f, 7.25)), f);
    }
  });

  test("real-колонки — до 0.1", () => {
    for (const f of ["fiber", "sugar", "sodium", "saturatedFat"]) {
      assert.equal(roundFoodLogField(f, 3.14), 3.1, f);
    }
  });

  test("неизвестное или служебное поле — undefined, писать нельзя", () => {
    assert.equal(roundFoodLogField("userId", 5), undefined);
    assert.equal(roundFoodLogField("id", 5), undefined);
    assert.equal(roundFoodLogField("foodScore", 5), undefined);
    assert.equal(roundFoodLogField("__proto__", 5), undefined);
  });
});
