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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `tma ${getInitData()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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
};
