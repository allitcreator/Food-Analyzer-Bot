/**
 * Чистые функции клиента Mini App (client/src/lib): цвета темы из Telegram
 * themeParams, «сегодня» в таймзоне профиля, тексты ошибок мутаций, валидация
 * веса в «Добавить еду». Без браузера и DOM.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeThemeColors,
  contrastRatio,
  mixHex,
} from "../client/src/lib/theme-colors";
import { todayInTimeZone } from "../client/src/lib/date-tz";
import { describeError } from "../client/src/lib/errors";
import { ApiError } from "../client/src/lib/api";
import { isValidFoodWeight } from "../client/src/lib/food-weight";

// Типичные themeParams клиентов Telegram (значения сняты с реальных клиентов).
const THEMES = {
  iosLight: {
    bg_color: "#ffffff",
    secondary_bg_color: "#efeff4",
    section_bg_color: "#ffffff",
    text_color: "#000000",
    hint_color: "#8e8e93",
    button_color: "#007aff",
    button_text_color: "#ffffff",
  },
  iosDark: {
    bg_color: "#000000",
    secondary_bg_color: "#1c1c1d",
    section_bg_color: "#2c2c2e",
    text_color: "#ffffff",
    hint_color: "#98989e",
    button_color: "#3e88f7",
    button_text_color: "#ffffff",
  },
  androidLight: {
    bg_color: "#ffffff",
    secondary_bg_color: "#f0f0f0",
    section_bg_color: "#ffffff",
    text_color: "#222222",
    hint_color: "#a8a8a8",
    button_color: "#50a8eb",
    button_text_color: "#ffffff",
  },
  androidDark: {
    bg_color: "#212d3b",
    secondary_bg_color: "#151e27",
    section_bg_color: "#1d2733",
    text_color: "#ffffff",
    hint_color: "#7d8b99",
    button_color: "#5288c1",
    button_text_color: "#ffffff",
  },
  // Старый Desktop без section_bg_color.
  desktopDark: {
    bg_color: "#17212b",
    secondary_bg_color: "#232e3c",
    text_color: "#f5f5f5",
    hint_color: "#708499",
    button_color: "#5288c1",
    button_text_color: "#ffffff",
  },
};

describe("theme colors", () => {
  test("contrastRatio: white/black = 21, same color = 1", () => {
    assert.equal(Math.round(contrastRatio("#ffffff", "#000000")), 21);
    assert.equal(contrastRatio("#123456", "#123456"), 1);
  });

  test("mixHex blends linearly in sRGB", () => {
    assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
    assert.equal(mixHex("#ffffff", "#000000", 0), "#ffffff");
  });

  for (const [name, tp] of Object.entries(THEMES)) {
    test(`${name}: page = secondary_bg, card = section_bg ?? bg`, () => {
      const c = computeThemeColors(tp);
      assert.equal(c.background, tp.secondary_bg_color);
      assert.equal(c.card, ("section_bg_color" in tp ? tp.section_bg_color : undefined) ?? tp.bg_color);
    });

    test(`${name}: secondary/muted/border are distinguishable from card`, () => {
      const c = computeThemeColors(tp);
      assert.ok(c.secondary && c.muted && c.border && c.card);
      assert.ok(contrastRatio(c.card, c.secondary) >= 1.1, `card vs secondary ${contrastRatio(c.card, c.secondary)}`);
      assert.ok(contrastRatio(c.card, c.muted) >= 1.1, `card vs muted ${contrastRatio(c.card, c.muted)}`);
      assert.ok(contrastRatio(c.card, c.border) >= 1.2, `card vs border ${contrastRatio(c.card, c.border)}`);
      // Текст на кнопках bg-secondary остаётся читаемым.
      assert.ok(contrastRatio(c.secondary, tp.text_color) >= 4.5);
    });
  }

  test("only bg_color known: nothing crashes, secondary still differs from card", () => {
    const c = computeThemeColors({ bg_color: "#ffffff" });
    assert.equal(c.background, "#ffffff");
    assert.equal(c.card, "#ffffff");
    assert.ok(contrastRatio(c.card, c.secondary!) >= 1.1);
  });

  test("garbage colors are ignored", () => {
    const c = computeThemeColors({ bg_color: "red", text_color: "#fff" });
    assert.equal(c.card, undefined);
    assert.equal(c.secondary, undefined);
  });
});

describe("todayInTimeZone", () => {
  const now = new Date("2026-10-26T22:30:00Z");

  test("uses the profile timezone, not the device clock", () => {
    assert.equal(todayInTimeZone("Europe/Moscow", now), "2026-10-27");
    assert.equal(todayInTimeZone("Asia/Vladivostok", now), "2026-10-27");
    assert.equal(todayInTimeZone("America/New_York", now), "2026-10-26");
  });

  test("null/empty timezone falls back to Europe/Moscow like the server", () => {
    assert.equal(todayInTimeZone(null, now), "2026-10-27");
    assert.equal(todayInTimeZone("", now), "2026-10-27");
  });

  test("invalid timezone does not throw", () => {
    assert.match(todayInTimeZone("Mars/Base", now), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("describeError", () => {
  test("network / timeout / rate limit / validation / fallback", () => {
    assert.match(describeError(new ApiError(0, "timeout"), "Не удалось сохранить"), /не ответил/);
    assert.match(describeError(new ApiError(0, "network"), "Не удалось сохранить"), /соединени/);
    assert.match(describeError(new TypeError("Failed to fetch"), "Не удалось сохранить"), /соединени/);
    assert.match(describeError(new ApiError(429), "x"), /подождите/);
    assert.match(describeError(new ApiError(400, "invalid"), "Не удалось сохранить"), /^Не удалось сохранить: проверьте/);
    assert.equal(describeError(new ApiError(500), "Не удалось сохранить"), "Не удалось сохранить");
  });
});

describe("isValidFoodWeight", () => {
  test("rejects 0, negatives, NaN and > 5000", () => {
    assert.equal(isValidFoodWeight(0), false);
    assert.equal(isValidFoodWeight(-5), false);
    assert.equal(isValidFoodWeight(Number.NaN), false);
    assert.equal(isValidFoodWeight(5001), false);
    assert.equal(isValidFoodWeight(1), true);
    assert.equal(isValidFoodWeight(250), true);
  });
});
