/**
 * Диалоговые шаги (ввод числа/времени): команда сбрасывает шаг, фото/голос
 * сбрасывают шаг и обрабатываются как обычно, состояние живёт не дольше TTL,
 * нечисловой текст оставляет шаг (бот переспрашивает с подсказкой /cancel).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decideDialogInput,
  isDialogStateExpired,
  isCancelCommand,
  DIALOG_STATE_TTL_MS,
  CANCEL_HINT,
} from "../server/lib/dialog-state";

const NOW = 1_800_000_000_000;
const fresh = { step: "edit_field_input", at: NOW - 60_000 };

describe("isDialogStateExpired", () => {
  test("свежее — не истекло, старше TTL — истекло", () => {
    assert.equal(DIALOG_STATE_TTL_MS, 30 * 60 * 1000);
    assert.equal(isDialogStateExpired({ at: NOW - DIALOG_STATE_TTL_MS }, NOW), false);
    assert.equal(isDialogStateExpired({ at: NOW - DIALOG_STATE_TTL_MS - 1 }, NOW), true);
  });
  test("без метки времени (застрявшее до деплоя) — истекло", () => {
    assert.equal(isDialogStateExpired({}, NOW), true);
  });
});

describe("isCancelCommand", () => {
  test("/cancel и /cancel@bot", () => {
    assert.equal(isCancelCommand("/cancel"), true);
    assert.equal(isCancelCommand("/cancel@FoodBot"), true);
    assert.equal(isCancelCommand(" /cancel "), true);
  });
  test("прочее — нет", () => {
    assert.equal(isCancelCommand("/cancelled"), false);
    assert.equal(isCancelCommand("cancel"), false);
    assert.equal(isCancelCommand(undefined), false);
  });
});

describe("decideDialogInput", () => {
  test("нет состояния", () => {
    assert.equal(decideDialogInput(undefined, { text: "банан" }, NOW), "no_state");
    assert.equal(decideDialogInput(undefined, { text: "/stats" }, NOW), "no_state");
  });
  test("любая команда в шаге сбрасывает его", () => {
    assert.equal(decideDialogInput(fresh, { text: "/stats" }, NOW), "reset_command");
    assert.equal(decideDialogInput(fresh, { text: "/profile" }, NOW), "reset_command");
  });
  test("/cancel оставляем хендлеру /cancel", () => {
    assert.equal(decideDialogInput(fresh, { text: "/cancel" }, NOW), "cancel_command");
  });
  test("истёкшее состояние сбрасывается", () => {
    assert.equal(decideDialogInput({ step: "ep_age", at: NOW - DIALOG_STATE_TTL_MS - 1 }, { text: "30" }, NOW), "reset_expired");
    assert.equal(decideDialogInput({ step: "ep_age" }, { text: "30" }, NOW), "reset_expired");
  });
  test("фото/голос без текста сбрасывают шаг", () => {
    assert.equal(decideDialogInput(fresh, {}, NOW), "reset_non_text");
  });
  test("текст (в т.ч. нечисловой) — обработать шагом", () => {
    assert.equal(decideDialogInput(fresh, { text: "150" }, NOW), "handle");
    assert.equal(decideDialogInput(fresh, { text: "банан" }, NOW), "handle");
  });
  test("подсказка упоминает /cancel", () => {
    assert.match(CANCEL_HINT, /\/cancel/);
  });
});
