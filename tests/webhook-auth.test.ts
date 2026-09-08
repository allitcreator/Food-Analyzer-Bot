/**
 * Сравнение секрета Telegram-вебхука.
 *
 * Секрет больше не ездит в пути URL (его печатал request-логгер на каждом
 * апдейте), поэтому единственная защита эндпоинта — заголовок
 * `x-telegram-bot-api-secret-token`. Сравнение вынесено в чистую функцию по
 * двум причинам: его нужно проверить тестом, и оно обязано идти за постоянное
 * время — иначе секрет подбирается по времени ответа.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { secretsMatch } from "../server/lib/webhook-auth";

describe("secretsMatch", () => {
  const secret = "0123456789abcdef0123456789abcdef";

  test("равные секреты совпадают", () => {
    assert.equal(secretsMatch(secret, secret), true);
    assert.equal(secretsMatch(secret, `${secret}`), true);
  });

  test("разные секреты той же длины не совпадают", () => {
    const other = `${secret.slice(0, -1)}0`;
    assert.equal(other.length, secret.length);
    assert.equal(secretsMatch(other, secret), false);
  });

  test("разная длина не совпадает и не роняет (timingSafeEqual кидает на разной длине)", () => {
    assert.equal(secretsMatch(secret.slice(0, 10), secret), false);
    assert.equal(secretsMatch(`${secret}x`, secret), false);
  });

  test("не-строка не совпадает ни с чем", () => {
    // express отдаёт заголовок массивом, если он пришёл дважды.
    assert.equal(secretsMatch([secret] as unknown as string, secret), false);
    assert.equal(secretsMatch(undefined, secret), false);
    assert.equal(secretsMatch(null, secret), false);
    assert.equal(secretsMatch(42, secret), false);
  });

  test("пустое значение не совпадает даже с пустым секретом", () => {
    // Иначе незаполненный WEBHOOK_SECRET открыл бы эндпоинт всем.
    assert.equal(secretsMatch("", ""), false);
    assert.equal(secretsMatch("", secret), false);
    assert.equal(secretsMatch(secret, ""), false);
  });

  test("сравнение чувствительно к регистру", () => {
    assert.equal(secretsMatch(secret.toUpperCase(), secret), false);
  });
});
