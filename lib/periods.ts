export function periodKeyFor(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (copy.getUTCDay() + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - sinceMonday);
  return copy.toISOString().slice(0, 10);
}

export function currentPeriod(now: Date = new Date()): string {
  return periodKeyFor(now);
}

export function nextPeriodStart(period: string): Date {
  const [y, m, d] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() + 7);
  return start;
}