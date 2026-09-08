/**
 * Компактная причина отказа `POST /api/quick` для лога сервера.
 *
 * Зачем отдельно от ответа клиенту: тело 400 уходит в шорткат, а он его молча
 * съедает — действие «Получить содержимое URL» на 4xx не прерывает выполнение.
 * С телефона видно только то, что карточка не пришла, поэтому единственное
 * место, где причину вообще можно прочитать, — лог.
 *
 * Чего здесь намеренно нет: содержимого полей. `imageBase64` — это мегабайты
 * мусора в логе, а `text` — подпись к еде, то есть личные данные. Для разбора
 * хватает длин, набора ключей и кодов ошибок.
 */

/** Плейсхолдер из `scripts/build-shortcuts.py` — признак «токен не подставили». */
const TOKEN_PLACEHOLDER_MARK = "ВСТАВЬ";

/**
 * Причина отказа 401 — по тем же мотивам, что и у 400: клиент ответ не видит.
 *
 * Сам токен в лог не идёт ни при каком раскладе: он даёт полный доступ к
 * дневнику, а nginx-логи мы от него уже однажды чистили.
 */
export function describeAuthRejection(
  header: unknown,
  parsedToken: string | null,
  userFound: boolean,
): string {
  const raw = typeof header === "string" ? header : "";
  if (!raw.trim()) return "no_header";

  const parts = [`header_len=${raw.length}`, `scheme=${raw.trim().split(/\s+/)[0]}`];
  parts.push(`placeholder=${raw.includes(TOKEN_PLACEHOLDER_MARK) ? "yes" : "no"}`);

  if (!parsedToken) {
    // Заголовок есть, но токен из него не вынулся: лишнее слово, перенос
    // строки, обрезанное значение.
    parts.push("parsed=no");
    return parts.join(" ");
  }

  parts.push("parsed=yes", `token_len=${parsedToken.length}`);
  parts.push(userFound ? "user=found" : "unknown_token");
  return parts.join(" ");
}

/** Часть `ZodIssue`, которой достаточно для лога (без завязки на версию zod). */
type QuickIssue = { readonly code: string; readonly path: ReadonlyArray<PropertyKey> };

function describeValue(value: unknown): string {
  if (typeof value === "string") return String(value.length);
  if (value === null) return "<null>";
  if (Array.isArray(value)) return "<array>";
  return `<${typeof value}>`;
}

export function describeQuickRejection(body: unknown, issues: ReadonlyArray<QuickIssue>): string {
  const parts: string[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    // express.json() на кривом Content-Type отдаёт строку или пустой объект —
    // такой случай надо отличать от «поля не те».
    parts.push(`body=${body === null ? "null" : Array.isArray(body) ? "array" : typeof body}`);
  } else {
    const record = body as Record<string, unknown>;
    parts.push(`keys=[${Object.keys(record).join(",")}]`);
    for (const field of ["text", "imageBase64"] as const) {
      if (field in record) parts.push(`${field}=${describeValue(record[field])}`);
    }
  }

  const codes = issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${issue.code}@${path || "<root>"}`;
  });
  parts.push(`issues=[${codes.join(" ")}]`);

  return parts.join(" ");
}
