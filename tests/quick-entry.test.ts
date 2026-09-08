/**
 * Быстрая запись с телефона (POST /api/quick) — чистая логика без сервера и БД:
 *  - форма синтетического Telegram-Update, который вбрасывается в бот;
 *  - разбор заголовка Authorization: Bearer;
 *  - контракт тела запроса (quickSchema).
 *
 * Форма апдейта — единственное место, где мы завязаны на внутренности
 * node-telegram-bot-api, поэтому она зафиксирована тестом: если апгрейд
 * библиотеки поменяет ожидаемые поля, сломается здесь, а не в проде.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSyntheticUpdate } from "../server/lib/synthetic-update";
import { extractBearerToken } from "../server/lib/quick-auth";
import { describeQuickRejection } from "../server/lib/quick-reject-log";
import { quickSchema } from "../shared/routes";
import { existsSync } from "node:fs";
import { buildQuickCardText, buildShortcutCaption, shortcutPath } from "../server/lib/quick-shortcut";

describe("buildSyntheticUpdate", () => {
  test("текст → message.text от лица пользователя", () => {
    const update = buildSyntheticUpdate("123456", { text: "овсянка 250 г" }) as any;
    assert.ok(update);
    assert.equal(update.message.text, "овсянка 250 г");
    assert.equal(update.message.chat.id, 123456);
    assert.equal(update.message.chat.type, "private");
    assert.equal(update.message.from.id, 123456);
    assert.equal(update.message.from.is_bot, false);
    assert.equal(typeof update.message.message_id, "number");
    assert.equal(typeof update.update_id, "number");
    // date — unix-время В СЕКУНДАХ (миллисекунды сломали бы форматирование дат).
    assert.ok(update.message.date < 100_000_000_000);
    assert.equal(update.message.photo, undefined);
  });

  test("фото → message.photo массивом размеров, самый крупный последний", () => {
    const update = buildSyntheticUpdate("42", { photoFileId: "AgACAgIAAxk" }) as any;
    assert.ok(update);
    assert.ok(Array.isArray(update.message.photo));
    assert.equal(update.message.photo.at(-1).file_id, "AgACAgIAAxk");
    assert.equal(update.message.text, undefined);
  });

  test("фото с подписью → caption на месте (P1-баг №10)", () => {
    const update = buildSyntheticUpdate("42", {
      photoFileId: "file-1",
      caption: "это борщ, 400 г",
    }) as any;
    assert.equal(update.message.caption, "это борщ, 400 г");
  });

  test("фото имеет приоритет над текстом — текст уезжает подписью", () => {
    const update = buildSyntheticUpdate("42", {
      photoFileId: "file-1",
      text: "не должно попасть в text",
      caption: "подпись",
    }) as any;
    assert.equal(update.message.text, undefined);
    assert.equal(update.message.caption, "подпись");
  });

  test("пустой payload и нечисловой id → null", () => {
    assert.equal(buildSyntheticUpdate("42", {}), null);
    assert.equal(buildSyntheticUpdate("не-число", { text: "еда" }), null);
    assert.equal(buildSyntheticUpdate("", { text: "еда" }), null);
  });

  test("id монотонно растут — два подряд апдейта не совпадают", () => {
    const a = buildSyntheticUpdate("42", { text: "раз" }) as any;
    const b = buildSyntheticUpdate("42", { text: "два" }) as any;
    assert.notEqual(a.update_id, b.update_id);
    assert.notEqual(a.message.message_id, b.message.message_id);
  });
});

describe("extractBearerToken", () => {
  const token = "a".repeat(48);

  test("валидный заголовок", () => {
    assert.equal(extractBearerToken(`Bearer ${token}`), token);
    assert.equal(extractBearerToken(`  Bearer ${token}  `), token);
  });

  test("чужие схемы и мусор → null", () => {
    assert.equal(extractBearerToken(`tma ${token}`), null);
    assert.equal(extractBearerToken(token), null);
    assert.equal(extractBearerToken("Bearer"), null);
    assert.equal(extractBearerToken(""), null);
    assert.equal(extractBearerToken(undefined), null);
    assert.equal(extractBearerToken(["Bearer", token]), null);
  });

  test("слишком короткий токен и недопустимые символы → null", () => {
    assert.equal(extractBearerToken("Bearer abc"), null);
    assert.equal(extractBearerToken(`Bearer ${"a".repeat(47)} extra`), null);
    assert.equal(extractBearerToken(`Bearer ${"a".repeat(47)}$`), null);
  });
});

describe("quickSchema", () => {
  const png = "aGVsbG8=";

  test("текст, фото и фото с подписью — всё валидно", () => {
    assert.equal(quickSchema.safeParse({ text: "овсянка" }).success, true);
    assert.equal(quickSchema.safeParse({ imageBase64: png }).success, true);
    assert.equal(quickSchema.safeParse({ text: "борщ 400 г", imageBase64: png }).success, true);
  });

  test("фото без подписи: шорткат всё равно шлёт поле text", () => {
    // «Запросить ввод» с пустым ответом отдаёт пустую строку, поэтому рядом с
    // картинкой приезжает text: "" — это фото без подписи, а не ошибка ввода.
    const empty = quickSchema.safeParse({ text: "", imageBase64: png });
    assert.equal(empty.success, true);
    assert.equal(empty.success && empty.data.text, undefined);

    const spaces = quickSchema.safeParse({ text: "   ", imageBase64: png });
    assert.equal(spaces.success, true);
    assert.equal(spaces.success && spaces.data.text, undefined);
  });

  test("пустое тело и лишние поля отвергаются", () => {
    assert.equal(quickSchema.safeParse({}).success, false);
    assert.equal(quickSchema.safeParse({ text: "" }).success, false);
    assert.equal(quickSchema.safeParse({ text: "еда", confirm: 0 }).success, false);
  });

  test("base64 с переносами строк принимается и склеивается", () => {
    // Действие «Кодировать в Base64» в Shortcuts по умолчанию рвёт строку на 76
    // символов — требовать от человека лезть в настройки действия не хотим.
    const parsed = quickSchema.safeParse({ imageBase64: "aGVs\r\nbG8=" });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.imageBase64, "aGVsbG8=");
  });

  test("data:-префикс по-прежнему отвергается — нужна голая base64", () => {
    assert.equal(quickSchema.safeParse({ imageBase64: "data:image/jpeg;base64,aGVsbG8=" }).success, false);
  });

  test("границы: текст до 2000 символов, картинка до 1.4 МБ base64", () => {
    assert.equal(quickSchema.safeParse({ text: "я".repeat(2000) }).success, true);
    assert.equal(quickSchema.safeParse({ text: "я".repeat(2001) }).success, false);
    assert.equal(quickSchema.safeParse({ imageBase64: "a".repeat(1_400_000) }).success, true);
    assert.equal(quickSchema.safeParse({ imageBase64: "a".repeat(1_400_001) }).success, false);
  });

  test("лимит считается по очищенной строке — переносы в него не входят", () => {
    // 1.4 МБ данных + переносы каждые 76 символов: сырая строка длиннее лимита,
    // очищенная — ровно на границе.
    const chunks: string[] = [];
    for (let i = 0; i < 1_400_000; i += 76) chunks.push("a".repeat(Math.min(76, 1_400_000 - i)));
    assert.equal(quickSchema.safeParse({ imageBase64: chunks.join("\r\n") }).success, true);
  });
});

/**
 * Причина отказа 400 нужна в логе сервера: шорткат тело ответа не показывает —
 * «Получить содержимое URL» на 4xx молча идёт дальше, и с телефона видно лишь
 * что карточка не пришла. При этом в лог нельзя тащить сам base64 (мегабайты
 * мусора) и текст подписи (это еда пользователя) — только длины и коды.
 */
describe("describeQuickRejection", () => {
  test("длины полей и коды ошибок, без содержимого", () => {
    const out = describeQuickRejection(
      { text: "борщ", imageBase64: "aGVsbG8=" },
      [{ code: "too_big", path: ["imageBase64"] }],
    );
    assert.match(out, /keys=\[text,imageBase64\]/);
    assert.match(out, /text=4/);
    assert.match(out, /imageBase64=8/);
    assert.match(out, /issues=\[too_big@imageBase64\]/);
    // Ни подпись, ни картинка в лог не попадают.
    assert.equal(out.includes("борщ"), false);
    assert.equal(out.includes("aGVsbG8="), false);
  });

  test("лишние ключи видны — под них у схемы strict", () => {
    const out = describeQuickRejection(
      { image: "aGVsbG8=" },
      [{ code: "unrecognized_keys", path: [] }],
    );
    assert.match(out, /keys=\[image\]/);
    assert.match(out, /issues=\[unrecognized_keys@<root>\]/);
  });

  test("поле не строкой — видно тип, а не длину", () => {
    const out = describeQuickRejection({ text: 42, imageBase64: null }, []);
    assert.match(out, /text=<number>/);
    assert.match(out, /imageBase64=<null>/);
  });

  test("тело вообще не объект", () => {
    assert.match(describeQuickRejection("плохо", []), /body=string/);
    assert.match(describeQuickRejection(null, []), /body=null/);
    assert.match(describeQuickRejection([1], []), /body=array/);
  });
});

/**
 * Выдача шортката из бота (/quick). Файл лежит в репозитории и уезжает
 * документом, поэтому тест следит за двумя вещами: что файл на месте (иначе
 * команда упадёт уже в проде) и что инструкция не растеряла шаги — без токена
 * в заголовке шорткат молча получает 401.
 */
describe("выдача шортката из /quick", () => {
  test("файл шортката лежит в репозитории", () => {
    assert.equal(existsSync(shortcutPath()), true, `нет файла: ${shortcutPath()}`);
  });

  test("карточка содержит токен, адрес и шаги установки", () => {
    const card = buildQuickCardText("t0ken123", "https://example.com");
    assert.match(card, /t0ken123/);
    assert.match(card, /https:\/\/example\.com\/api\/quick/);
    // Шаги импорта: без «Ненадёжных команд» файл не откроется, без токена —
    // не авторизуется. Оба пункта обязаны быть в тексте.
    assert.match(card, /Ненадёжные/i);
    assert.match(card, /Authorization/);
  });

  test("базовый адрес без хвостового слеша", () => {
    const card = buildQuickCardText("t", "https://example.com/");
    assert.match(card, /https:\/\/example\.com\/api\/quick/);
    assert.equal(card.includes("example.com//api"), false);
  });

  test("подпись к файлу короче лимита Telegram", () => {
    assert.ok(buildShortcutCaption().length < 1024);
  });
});
