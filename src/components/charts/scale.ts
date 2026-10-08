/** A round tick step that puts at most six ticks on a scale up to `max`. */
export function niceStep(max: number): number {
  for (const s of [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]) if (max / s <= 6) return s;
  return 250000;
}
