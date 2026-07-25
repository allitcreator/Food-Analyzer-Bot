/**
 * Unit tests for createPersistentRecord / loadPersistentState.
 * A fake sink stands in for storage — no DB / env needed. Verifies the Proxy
 * keeps plain Record semantics in memory and mirrors mutations to the sink,
 * and that a failing sink write never bubbles out of the record.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createPersistentRecord,
  loadPersistentState,
  type PersistentStateSink,
} from "../server/lib/persistent-state";

// Let queued fire-and-forget writes (Promise.resolve → then) settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

class FakeSink implements PersistentStateSink {
  upserts: { telegramId: string; key: string; value: unknown }[] = [];
  deletes: { telegramId: string; key: string }[] = [];
  rows: { telegramId: string; key: string; value: unknown }[] = [];
  failWrites = false;

  async loadAllBotState() {
    return this.rows;
  }
  async upsertBotState(telegramId: string, key: string, value: unknown) {
    this.upserts.push({ telegramId, key, value });
    if (this.failWrites) throw new Error("PG down");
  }
  async deleteBotState(telegramId: string, key: string) {
    this.deletes.push({ telegramId, key });
    if (this.failWrites) throw new Error("PG down");
  }
}

describe("createPersistentRecord", () => {
  test("set mutates memory AND upserts to sink (telegram_id=key, key=name)", async () => {
    const sink = new FakeSink();
    const rec = createPersistentRecord<number>("counters", {}, sink);

    rec["u1"] = 42;

    assert.equal(rec["u1"], 42); // memory updated synchronously
    await flush();
    assert.deepEqual(sink.upserts, [{ telegramId: "u1", key: "counters", value: 42 }]);
  });

  test("delete removes from memory AND deletes in sink", async () => {
    const sink = new FakeSink();
    const rec = createPersistentRecord<number>("counters", { u1: 1 }, sink);

    delete rec["u1"];

    assert.equal("u1" in rec, false);
    assert.equal(rec["u1"], undefined);
    await flush();
    assert.deepEqual(sink.deletes, [{ telegramId: "u1", key: "counters" }]);
  });

  test("reads / has / key iteration are synchronous from the snapshot", async () => {
    const sink = new FakeSink();
    const rec = createPersistentRecord<{ n: number }>(
      "objs",
      { a: { n: 1 }, b: { n: 2 } },
      sink,
    );

    assert.equal("a" in rec, true);
    assert.equal("z" in rec, false);
    assert.deepEqual(Object.keys(rec).sort(), ["a", "b"]);
    assert.deepEqual(rec["a"], { n: 1 });
    assert.equal(sink.upserts.length, 0); // pure reads don't write
  });

  // Документирует известный caveat: ловушка set срабатывает только на
  // присваивание ВЕРХНЕГО ключа. Вложенная мутация меняет память, но НЕ пишет
  // в PG — после неё обязателен «touch» (переприсваивание верхнего ключа).
  test("caveat: nested mutation does NOT persist; a top-key touch does", async () => {
    const sink = new FakeSink();
    const rec = createPersistentRecord<{ step: string; n: number }>("states", {}, sink);

    rec["u1"] = { step: "age", n: 1 };
    await flush();
    assert.equal(sink.upserts.length, 1);

    // Nested mutation via alias: memory changes, sink does NOT see it.
    const alias = rec["u1"];
    alias.step = "weight";
    alias.n = 2;
    await flush();
    assert.equal(rec["u1"].step, "weight");
    assert.equal(sink.upserts.length, 1); // still just the initial write

    // The touch convention: re-assign the top key → persist fires with fresh value.
    rec["u1"] = alias;
    await flush();
    assert.equal(sink.upserts.length, 2);
    assert.deepEqual(sink.upserts[1], {
      telegramId: "u1",
      key: "states",
      value: { step: "weight", n: 2 },
    });
  });

  test("a failing sink write is swallowed, never thrown", async () => {
    const sink = new FakeSink();
    sink.failWrites = true;
    const rec = createPersistentRecord<number>("counters", {}, sink);

    assert.doesNotThrow(() => {
      rec["u1"] = 7; // set trap must not throw despite the rejecting write
    });
    assert.equal(rec["u1"], 7); // memory still updated
    await flush(); // rejection handled internally (logged), no unhandled rejection
    assert.equal(sink.upserts.length, 1);
  });
});

describe("loadPersistentState", () => {
  test("groups rows by key (record name) into per-record snapshots", async () => {
    const sink = new FakeSink();
    sink.rows = [
      { telegramId: "u1", key: "pendingLogs", value: { foodName: "яблоко" } },
      { telegramId: "u2", key: "pendingLogs", value: { foodName: "банан" } },
      { telegramId: "u1", key: "userStates", value: { step: "age" } },
    ];

    const state = await loadPersistentState(sink);

    assert.deepEqual(state.get("pendingLogs"), {
      u1: { foodName: "яблоко" },
      u2: { foodName: "банан" },
    });
    assert.deepEqual(state.get("userStates"), { u1: { step: "age" } });
    assert.equal(state.has("nope"), false);
  });

  test("empty table → empty map", async () => {
    const sink = new FakeSink();
    const state = await loadPersistentState(sink);
    assert.equal(state.size, 0);
  });
});
