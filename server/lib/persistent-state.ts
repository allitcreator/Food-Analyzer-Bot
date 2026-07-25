/**
 * Persistent in-memory records for the bot.
 *
 * `createPersistentRecord` wraps a plain snapshot object in a Proxy that keeps
 * the exact `Record<string, T>` semantics the bot already relies on — reads,
 * `in`, key iteration and `delete` all happen synchronously against the
 * in-memory copy — while mirroring every write and delete into Postgres so the
 * state survives a deploy/restart.
 *
 * Writes are fire-and-forget: a PG hiccup is logged and swallowed, never
 * thrown, so the live in-memory record keeps working regardless of the DB.
 *
 * ВАЖНО — семантика персиста и конвенция «touch»:
 * ловушки Proxy срабатывают ТОЛЬКО на присваивание/удаление ВЕРХНЕГО ключа
 * (`rec[id] = x`, `delete rec[id]`). Вложенные мутации значения —
 * `rec[id].field = y`, `rec[id].splice(...)`, мутация через алиас
 * (`const v = rec[id]; v.field = y`) — меняют память, но НЕ пишутся в PG:
 * копия в БД молча протухает, и после рестарта восстановится устаревшее
 * состояние. Конвенция: после любой вложенной мутации записи, которая
 * продолжает жить (не удаляется тут же), делайте «touch» — переприсвойте
 * верхний ключ, чтобы триггернуть ловушку: `rec[id] = v;`.
 *
 * Storage layout in `bot_state`: telegram_id = the record's key (e.g. a user's
 * Telegram id), key = the record `name` (e.g. "pendingLogs"), value = JSON.
 */

// Just the slice of storage this module needs — lets unit tests inject a fake
// without pulling in the DB layer (and its env-dependent config).
export interface PersistentStateSink {
  loadAllBotState(): Promise<{ telegramId: string; key: string; value: unknown }[]>;
  upsertBotState(telegramId: string, key: string, value: unknown): Promise<void>;
  deleteBotState(telegramId: string, key: string): Promise<void>;
}

// Lazily resolve the real storage via dynamic import, so merely importing this
// module (as the unit test does, passing a fake sink) does not load storage.
let realSink: Promise<PersistentStateSink> | null = null;
function defaultSink(): Promise<PersistentStateSink> {
  if (!realSink) realSink = import("../storage").then((m) => m.storage);
  return realSink;
}

export function createPersistentRecord<T>(
  name: string,
  snapshot: Record<string, T>,
  sink: PersistentStateSink | Promise<PersistentStateSink> = defaultSink(),
): Record<string, T> {
  const write = (fn: (s: PersistentStateSink) => Promise<void>) => {
    Promise.resolve(sink).then(fn).catch((err) =>
      console.error(`persistent-state[${name}] write failed:`, err),
    );
  };
  return new Proxy(snapshot, {
    set(target, prop, value) {
      if (typeof prop === "string") {
        target[prop] = value;
        write((s) => s.upsertBotState(prop, name, value));
        return true;
      }
      (target as any)[prop] = value;
      return true;
    },
    deleteProperty(target, prop) {
      if (typeof prop === "string") {
        delete target[prop];
        write((s) => s.deleteBotState(prop, name));
        return true;
      }
      delete (target as any)[prop];
      return true;
    },
  });
}

/**
 * Load the whole `bot_state` table once and group rows by `key` (the record
 * name) into per-record snapshots, ready to feed into createPersistentRecord.
 */
export async function loadPersistentState(
  sink: PersistentStateSink | Promise<PersistentStateSink> = defaultSink(),
): Promise<Map<string, Record<string, unknown>>> {
  const s = await Promise.resolve(sink);
  const rows = await s.loadAllBotState();
  const byName = new Map<string, Record<string, unknown>>();
  for (const { telegramId, key, value } of rows) {
    let rec = byName.get(key);
    if (!rec) { rec = {}; byName.set(key, rec); }
    rec[telegramId] = value;
  }
  return byName;
}
