import { getToken } from "./api";

const cache = new Map<string, string>();

export async function authObjectUrl(path: string): Promise<string> {
  const existing = cache.get(path);
  if (existing) return existing;
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`/api${path}`, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Could not load file.");
  const url = URL.createObjectURL(await res.blob());
  cache.set(path, url);
  return url;
}
