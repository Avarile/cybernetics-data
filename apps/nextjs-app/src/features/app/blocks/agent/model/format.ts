/** An amount as the readouts show money: whole units, grouped, no currency symbol. */
export const money = (n: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

/**
 * When, as the flight log shows it (UTC): the time today, the month and day before today, and
 * dashes for a step that has not run yet.
 */
export const logTime = (ms: number, now = Date.now()) => {
  if (!ms) return '--:--';
  const d = new Date(ms);
  const n = new Date(now);
  const p = (x: number) => String(x).padStart(2, '0');
  const today =
    d.getUTCFullYear() === n.getUTCFullYear() &&
    d.getUTCMonth() === n.getUTCMonth() &&
    d.getUTCDate() === n.getUTCDate();
  return today
    ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
    : `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
