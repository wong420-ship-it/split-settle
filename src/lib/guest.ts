// Local storage helpers for guests (no auth)
const KEY = (code: string) => `seatsolo:guest:${code.toUpperCase()}`;

export type GuestIdentity = { id: string; name: string };

export function getGuest(code: string): GuestIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY(code));
    return raw ? (JSON.parse(raw) as GuestIdentity) : null;
  } catch {
    return null;
  }
}

export function setGuest(code: string, g: GuestIdentity) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY(code), JSON.stringify(g));
}

export function clearGuest(code: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY(code));
}
