// Accepte aussi un domaine sans "https://" (ex. référence Railway RAILWAY_PUBLIC_DOMAIN) ou entre guillemets
function normalizeApiUrl(raw: string | undefined): string {
  let url = (raw ?? "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (!url) return "http://localhost:8000";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);
const TOKEN_KEY = "frigood_token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // stockage indisponible (navigation privée) : la session ne survivra pas au rechargement
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface Options {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
}

export async function api<T>(path: string, { method = "GET", body, query }: Options = {}): Promise<T> {
  let url: URL;
  try {
    url = new URL(API_URL + path);
  } catch {
    throw new ApiError(0, `Adresse de l'API invalide (VITE_API_URL = « ${API_URL} »)`);
  }
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Impossible de joindre le serveur (${API_URL})`);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    } catch {
      // réponse non JSON
    }
    // Une session Garmin expirée renvoie aussi 401 : ce n'est pas la session Frigood
    if (res.status === 401 && token && detail !== "SESSION_GARMIN_EXPIREE") onUnauthorized?.();
    throw new ApiError(res.status, detail);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
