/** Compares dotted versions ("2.4", "2.4.1"): negative when a is older than b, 0 when equal. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Whether `current` is older than the founder's minimum. An empty or unreadable minimum never blocks. */
export function isBelowMinimum(current: string, minimum: string | undefined | null): boolean {
  if (!minimum || !/^\d+(\.\d+){0,2}$/.test(minimum)) return false;
  return compareVersions(current, minimum) < 0;
}
