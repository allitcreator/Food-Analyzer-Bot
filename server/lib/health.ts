import type { Request, Response } from "express";
import { describeError } from "./safe-log";

/**
 * Хендлер /api/health: 200, если `ping` (на проде — `SELECT 1`) успел за
 * `timeoutMs`, иначе 503. Текст ошибки остаётся в логе, наружу уходит только
 * `{"status":"error"}` — в сообщениях pg бывают хост, имя пользователя, база.
 */
export function createHealthHandler(
  ping: () => Promise<unknown>,
  timeoutMs: number,
) {
  return async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        ping(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`health ping timeout ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      res.json({ status: "ok", timestamp: Date.now() });
    } catch (err) {
      console.error("Health check failed:", describeError(err));
      res.status(503).json({ status: "error", timestamp: Date.now() });
    } finally {
      clearTimeout(timer);
    }
  };
}
