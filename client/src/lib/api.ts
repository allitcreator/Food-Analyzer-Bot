/**
 * Thin fetch client for `/api/app/*`. Adds the Telegram auth header to every
 * request and turns non-2xx responses into typed {@link ApiError}s so the UI
 * can distinguish 401 (open from Telegram) / 403 (pending approval) states.
 */
import { getInitData } from "./telegram";
import type {
  MeResponse,
  DayResponse,
  StatsResponse,
  WeightResponse,
  FoodLog,
  UpdateLogBody,
  ProfilePatchBody,
  SettingsPatchBody,
  Favorite,
  CreateFavoriteBody,
  LogApplyResponse,
  AnalyzedItem,
  AnalyzeResponse,
} from "./types";

const BASE = "/api/app";

export class ApiError extends Error {
  status: number;
  reason?: string;
  constructor(status: number, reason?: string, message?: string) {
    super(message ?? reason ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
  }
}

/** Таймауты запросов: AI-анализ фото/текста долгий, остальное — быстрое. */
export const DEFAULT_TIMEOUT_MS = 15_000;
export const ANALYZE_TIMEOUT_MS = 60_000;

/** AbortSignal.timeout есть не во всех WebView Telegram (iOS < 16) — фолбэк. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new DOMException("Timeout", "TimeoutError")), ms);
  return ctrl.signal;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `tma ${getInitData()}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeoutSignal(timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError(0, "timeout", "Сервер не ответил вовремя");
    }
    throw new ApiError(0, "network", "Нет соединения с сервером");
  }

  if (!res.ok) {
    let reason: string | undefined;
    try {
      const json = await res.json();
      reason = json.reason ?? json.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, reason);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<MeResponse>("GET", "/me"),
  day: (date?: string) =>
    request<DayResponse>("GET", date ? `/day?date=${date}` : "/day"),
  stats: (range: "week" | "month") =>
    request<StatsResponse>("GET", `/stats?range=${range}`),
  weight: (limit = 90) =>
    request<WeightResponse>("GET", `/weight?limit=${limit}`),
  updateLog: (id: number, body: UpdateLogBody) =>
    request<FoodLog>("PATCH", `/logs/${id}`, body),
  deleteLog: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/logs/${id}`),
  addWater: (amount: number) =>
    request<{ ok: boolean; waterTotal: number }>("POST", "/water", { amount }),
  deleteWater: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/water/${id}`),
  updateProfile: (body: ProfilePatchBody) =>
    request<MeResponse>("PATCH", "/profile", body),
  updateSettings: (body: SettingsPatchBody) =>
    request<MeResponse>("PATCH", "/settings", body),

  // Favorites + one-tap repeat.
  favorites: () =>
    request<{ favorites: Favorite[] }>("GET", "/favorites"),
  createFavorite: (body: CreateFavoriteBody) =>
    request<Favorite>("POST", "/favorites", body),
  setFavoriteShared: (id: number, isShared: boolean) =>
    request<Favorite>("PATCH", `/favorites/${id}`, { isShared }),
  deleteFavorite: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/favorites/${id}`),
  logFavorite: (id: number) =>
    request<LogApplyResponse>("POST", `/favorites/${id}/log`),
  repeatLog: (id: number) =>
    request<LogApplyResponse>("POST", `/logs/${id}/repeat`),

  // Ручной ввод еды: AI-анализ фото/текста → подтверждение → запись.
  analyzeFood: (payload: { text?: string; imageBase64?: string }) =>
    request<AnalyzeResponse>("POST", "/analyze", payload, ANALYZE_TIMEOUT_MS),
  createLogs: (items: AnalyzedItem[]) =>
    request<LogApplyResponse>("POST", "/logs", { items }),
};
