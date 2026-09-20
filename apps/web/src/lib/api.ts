const TOKEN_KEY = "mybrandos_session_token";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Preserve browser brand context through Vite and first-party proxies.
  headers.set("x-mybrandos-host", window.location.hostname);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (!res.ok) {
    let code = "request_failed";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      code = body.error ?? code;
      message = body.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export function uploadForm<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number | null) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-mybrandos-host", window.location.hostname);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      } else {
        onProgress(null);
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "request_failed", "Upload failed. Retry."));
    xhr.onload = () => {
      let parsed: { error?: string; message?: string } = {};
      try {
        parsed = JSON.parse(xhr.responseText || "{}") as { error?: string; message?: string };
      } catch {
        /* ignore */
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new ApiError(
            xhr.status,
            parsed.error ?? "request_failed",
            parsed.message ?? (xhr.statusText || "Upload failed. Retry."),
          ),
        );
        return;
      }
      resolve(parsed as T);
    };
    xhr.send(form);
  });
}
