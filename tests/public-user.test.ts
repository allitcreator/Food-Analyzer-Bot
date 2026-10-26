/**
 * Ответ /api/app/me и PATCH /profile|/settings: только поля, которые читает
 * Mini App. Служебные поля (токен быстрой записи, telegramId, флаги доступа)
 * наружу не уходят.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicUser, PUBLIC_USER_FIELDS } from "../server/lib/public-user";
import type { User } from "../shared/schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Имена полей `interface MeResponse` из клиентских типов. */
function meResponseFields(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "client/src/lib/types.ts"), "utf8");
  const body = src.match(/export interface MeResponse \{([\s\S]*?)\n\}/);
  assert.ok(body, "в client/src/lib/types.ts нет interface MeResponse");
  return [...body[1].matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
}

const fullUser: User = {
  id: 7,
  telegramId: "123456",
  username: "someone",
  isApproved: true,
  isAdmin: true,
  isBlocked: false,
  age: 30,
  gender: "male",
  weight: 80,
  height: 180,
  activityLevel: "moderate",
  goal: "maintain",
  caloriesGoal: 2500,
  proteinGoal: 150,
  fatGoal: 80,
  carbsGoal: 300,
  reportTime: "21:00",
  breakfastReminder: "off",
  lunchReminder: "off",
  dinnerReminder: "off",
  noLogReminderTime: "off",
  weightReminderTime: "off",
  weightReminderDays: "",
  showMicronutrients: false,
  aiWeekAnalysis: true,
  aiMonthAnalysis: true,
  aiEveningReport: true,
  smartFoodGrouping: true,
  barcodeScanEnabled: true,
  smartReminders: false,
  quickToken: "secret-quick-token",
  timezone: "Europe/Moscow",
  mealBreakfastEnd: "12:30",
  mealLunchEnd: "16:30",
  createdAt: new Date(0),
};

describe("publicUser", () => {
  test("нет токена быстрой записи и служебных полей", () => {
    const out = publicUser(fullUser) as Record<string, unknown>;
    for (const key of ["quickToken", "telegramId", "isAdmin", "isBlocked", "isApproved", "id", "createdAt"]) {
      assert.equal(key in out, false, `${key} не должен уходить клиенту`);
    }
    assert.ok(!JSON.stringify(out).includes("secret-quick-token"));
  });

  test("есть все поля клиентского типа MeResponse (кроме goals, их добавляет роут)", () => {
    const out = publicUser(fullUser) as Record<string, unknown>;
    const expected = meResponseFields().filter((f) => f !== "goals");
    for (const f of expected) assert.ok(f in out, `нет поля ${f}`);
    assert.deepEqual([...PUBLIC_USER_FIELDS].sort(), [...expected].sort(), "allowlist и MeResponse разошлись");
  });

  test("значения копируются как есть", () => {
    const out = publicUser(fullUser);
    assert.equal(out.timezone, "Europe/Moscow");
    assert.equal(out.weight, 80);
    assert.equal(out.showMicronutrients, false);
  });
});
