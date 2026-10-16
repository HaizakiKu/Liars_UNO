import type { CreateRoomRequest } from "../../shared/protocol";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "network");
  return data;
}

export const createRoom = (req: CreateRoomRequest) => post<{ code: string }>("/api/rooms", req);
export const quickJoin = (req: CreateRoomRequest) => post<{ code: string }>("/api/quick-join", req);

export async function roomExists(code: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/rooms/${code}`);
    if (res.status === 404 || res.status === 400) return false;
    return res.ok;
  } catch {
    return null;
  }
}

export function wsUrl(path: string) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}
