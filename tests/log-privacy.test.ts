/**
 * Приватность логов: в docker logs не должно попадать то, что написал
 * пользователь.
 *
 * Повод. Бот печатал в stdout текст сообщений, расшифровку голосовых, результат
 * распознавания фото и профиль (вес, рост, возраст, пол) — всё это лежало в
 * логах контейнера без ротации и было видно каждому, у кого есть доступ к
 * серверу. Отдельная беда — `console.error("...", err)`: объекты ошибок
 * Telegram и body-parser таскают внутри себя тела запросов и ответов.
 *
 * Тест из двух частей:
 *
 * 1. Юнит-тесты `describeError` — он и есть безопасная замена печати ошибки
 *    целиком.
 * 2. Статический guard по `server/**\/*.ts`: ни один вызов `console.*` и ни
 *    один вызов хелпера `log()` из `server/index.ts` не должен упоминать
 *    пользовательский контент. Список запрещённых
 *    идентификаторов ниже — это ровно те места, на которых мы уже обожглись,
 *    плюс `JSON.stringify(`, потому что сериализация объекта в лог почти
 *    всегда означает «сюда однажды попадут данные пользователя».
 *
 * Guard намеренно грубый: он ловит имя переменной, а не смысл. Если он ругается
 * на безобидную строку — лучше переписать лог (вывести длину, количество, id),
 * чем ослаблять правило.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeError } from "../server/lib/safe-log";

describe("describeError", () => {
  test("обычный Error: имя, message и фреймы стека", () => {
    const out = describeError(new TypeError("boom"));
    assert.ok(out.startsWith("TypeError: boom"), `неожиданное начало: ${out}`);

    // Без стека по логу непонятно, откуда прилетела ошибка, — а стек, в
    // отличие от объекта ошибки, пользовательских данных не содержит.
    const lines = out.split("\n");
    assert.ok(lines.length > 1, `фреймы стека не попали в лог: ${out}`);
    assert.ok(lines[1].startsWith("    at "), `вторая строка не фрейм: ${lines[1]}`);
    assert.ok(lines.length <= 6, `фреймов больше пяти: ${lines.length - 1}`);
  });

  test("TelegramError: есть message и code, но нет тела запроса", () => {
    const err = {
      name: "TelegramError",
      message: "ETELEGRAM: 400 Bad Request: message is too long",
      code: "ETELEGRAM",
      response: {
        body: { ok: false, error_code: 400, description: "message is too long" },
        request: { body: "СЕКРЕТНЫЙ ТЕКСТ ПОЛЬЗОВАТЕЛЯ" },
      },
    };
    const out = describeError(err);
    assert.match(out, /message is too long/);
    assert.match(out, /code=ETELEGRAM/);
    assert.ok(!out.includes("СЕКРЕТНЫЙ ТЕКСТ"), `тело запроса утекло в лог: ${out}`);
    assert.ok(!out.includes("ПОЛЬЗОВАТЕЛЯ"), `тело запроса утекло в лог: ${out}`);
  });

  test("ошибка body-parser: ни тело запроса, ни message не печатаются", () => {
    const err = Object.assign(new SyntaxError(`Unexpected token 'с', "{"text": секрет}" is not valid JSON`), {
      body: '{"text": секрет}',
      type: "entity.parse.failed",
      status: 400,
    });
    const out = describeError(err);
    assert.match(out, /SyntaxError/);
    assert.match(out, /type=entity\.parse\.failed/);
    assert.match(out, /status=400/);
    // V8 вставляет в message фрагмент разбираемой строки, поэтому message у
    // таких ошибок в лог не идёт совсем.
    assert.ok(!out.includes("секрет"), `тело запроса утекло в лог: ${out}`);
    assert.ok(!out.includes("is not valid JSON"), `message разбора утёк в лог: ${out}`);
  });

  test("настоящий SyntaxError от JSON.parse не тащит разбираемую строку", () => {
    // Ровно то, что прилетает из express.json() на кривом теле от клиента.
    // Формулировка message зависит от версии V8, поэтому проверяем несколько
    // вариантов: часть из них цитирует исходную строку целиком.
    const bodies = ['{"text": секрет}', '{"text":"секрет" x}', "секрет"];

    for (const raw of bodies) {
      let out = "";
      try {
        JSON.parse(raw);
      } catch (e) {
        out = describeError(e);
      }
      assert.notEqual(out, "", `JSON.parse не упал на ${raw}`);
      assert.match(out, /SyntaxError/);
      assert.ok(!out.includes("секрет"), `тело запроса утекло в лог (${raw}): ${out}`);
    }
  });

  test("status берётся и из statusCode, error_code печатается", () => {
    const out = describeError({ name: "HTTPError", message: "fail", statusCode: 503, error_code: 42 });
    assert.match(out, /status=503/);
    assert.match(out, /error_code=42/);
  });

  test("строка описывает сама себя", () => {
    assert.equal(describeError("boom"), "boom");
  });

  test("undefined не роняет и не превращается в пустоту", () => {
    assert.equal(describeError(undefined), "undefined");
  });

  test("объект без message не сериализуется целиком", () => {
    const out = describeError({ request: { body: "СЕКРЕТ" } });
    assert.ok(!out.includes("СЕКРЕТ"), `объект утёк в лог: ${out}`);
  });
});

/**
 * Что запрещено упоминать внутри вызова `console.*`.
 *
 * Сравнение идёт по подстроке, поэтому под правило попадает и текст самого
 * сообщения: метка «Voice transcription» ловится на `transcript`. Это не баг —
 * такие метки проще переименовать, чем усложнять guard разбором AST.
 */
const FORBIDDEN = [
  "msg.text",
  "msg.caption",
  "transcript",
  "visionItems",
  "state.data",
  "foodName",
  "JSON.stringify(",
  // Секреты и идентификаторы, по которым восстанавливается либо доступ, либо
  // то, что ел пользователь: путь вебхука вместе с секретом, заголовок
  // Authorization и EAN (штрихкод однозначно называет продукт).
  "webhookUrl",
  "WEBHOOK_SECRET",
  "authorization",
  "barcode",
];

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Что считаем вызовом лога.
 *
 * Кроме `console.*` печатает ещё хелпер `log()` из `server/index.ts` — через
 * него идёт request-логгер, то есть метод, путь и код ответа на каждый запрос.
 * `\b` перед `log` не даёт зацепить `catalog(` и `dialog(`, а альтернатива
 * `console\.\w+` стоит первой, поэтому `console.log(` не считается дважды.
 */
const LOG_CALL = /\b(console\.\w+|log)\s*\(/g;

/**
 * Текст вызова лога, начиная с колонки `column` строки `lines[start]`.
 *
 * Вызов бывает многострочным, поэтому добираем строки, пока не закроются
 * скобки, но не больше шести — дальше почти наверняка уже не аргументы лога, а
 * соседний код, и ловить в нём запрещённые слова смысла нет.
 */
function readLogCall(lines: string[], start: number, column: number): string {
  let text = lines[start].slice(column);
  let depth = 0;
  let seenOpen = false;

  for (let i = start; i < Math.min(start + 6, lines.length); i++) {
    const chunk = i === start ? text : lines[i];
    if (i !== start) text += "\n" + chunk;
    for (const ch of chunk) {
      if (ch === "(") {
        depth++;
        seenOpen = true;
      } else if (ch === ")") {
        depth--;
      }
    }
    if (seenOpen && depth <= 0) break;
  }

  return text;
}

describe("логи сервера не содержат пользовательский контент", () => {
  test("ни один вызов console.* и log() не упоминает запрещённые поля", () => {
    const violations: string[] = [];

    for (const file of collectTsFiles(SERVER_DIR)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        LOG_CALL.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = LOG_CALL.exec(lines[i])) !== null) {
          const call = readLogCall(lines, i, match.index);
          for (const token of FORBIDDEN) {
            if (call.includes(token)) {
              violations.push(`${path.relative(SERVER_DIR, file)}:${i + 1} → ${token}`);
            }
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `в логах сервера остался пользовательский контент:\n${violations.join("\n")}`,
    );
  });
});
