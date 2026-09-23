// Dates au format ISO "YYYY-MM-DD" en heure locale (toISOString() passerait en UTC)

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const ms = parseISODate(toISO).getTime() - parseISODate(fromISO).getTime();
  return Math.round(ms / 86_400_000);
}

export function formatLong(iso: string): string {
  const s = parseISODate(iso).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatShort(iso: string): string {
  return parseISODate(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export function formatFull(iso: string): string {
  return parseISODate(iso).toLocaleDateString("fr-FR");
}
