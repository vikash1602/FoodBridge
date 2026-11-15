/** Thin fetch wrapper: JWT storage, consistent error shape, query-string helper. */

import type { ApiError } from "./types";

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API = `${BASE_URL}/api/v1`;

const ACCESS_KEY = "fb.access";
const REFRESH_KEY = "fb.refresh";

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class HttpError extends Error {
  status: number;
  body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body?.message ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const json = (await response.json()) as { error?: ApiError };
    if (json?.error) return json.error;
  } catch {
    /* non-JSON error */
  }
  return { code: `http_${response.status}`, message: response.statusText || "Network error" };
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = tokens.refresh;
  if (!refresh) return false;
  try {
    const response = await fetch(`${API}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { access: string };
    if (!data.access) return false;
    localStorage.setItem(ACCESS_KEY, data.access);
    return true;
  } catch {
    return false;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  formData?: FormData;
  auth?: boolean;
  retry?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, formData, auth = true, retry = true } = options;

  const headers: Record<string, string> = {};
  if (auth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new HttpError(0, { code: "network", message: "Can't reach the FoodBridge kitchen. Check your connection." });
  }

  if (response.status === 401 && retry && auth && tokens.refresh) {
    if (await refreshAccessToken()) {
      return request<T>(path, { ...options, retry: false });
    }
    tokens.clear();
  }

  if (!response.ok) {
    throw new HttpError(response.status, await parseError(response));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body" | "formData">) =>
    request<T>(path, { ...options }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body" | "formData">) =>
    request<T>(path, { method: "POST", body, ...options }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body" | "formData">) =>
    request<T>(path, { method: "PATCH", body, ...options }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: "POST", formData }),
};

/** Ask the backend for a short-lived, single-use stream ticket, then open the SSE URL with it. */
export async function streamUrl(): Promise<string> {
  const base = `${API}/stream/`;
  if (!tokens.access) return base;
  try {
    const { ticket } = await request<{ ticket: string }>("/stream/ticket/", { method: "POST" });
    return `${base}?ticket=${encodeURIComponent(ticket)}`;
  } catch {
    return base;
  }
}

/** Fallback URL without a ticket (used before the async ticket fetch resolves). */
export const streamUrlSync = (): string => `${API}/stream/`;
