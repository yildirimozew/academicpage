const zurichClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function localParts(date) {
  return Object.fromEntries(zurichClock.formatToParts(date)
    .filter(({ type }) => ["year", "month", "day", "hour", "minute", "second"].includes(type))
    .map(({ type, value }) => [type, Number(value)]));
}

function asUtc(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
}

export function uploadWindow(period, now = new Date()) {
  const before = now.toISOString();
  if (period === "any") return { before };
  if (period === "recent") return { after: new Date(now.getTime() - 7 * 86400_000).toISOString(), before };
  if (!["today", "week"].includes(period)) throw new Error("Choose a valid upload date filter.");

  const { year, month, day } = localParts(now);
  const midnight = new Date(Date.UTC(year, month - 1, day));
  if (period === "week") midnight.setUTCDate(midnight.getUTCDate() - (midnight.getUTCDay() + 6) % 7);
  const desired = midnight.getTime();
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant += desired - asUtc(localParts(new Date(instant)));
  }
  return { after: new Date(instant).toISOString(), before };
}

export function withinWindow(publishedAt, window) {
  const timestamp = Date.parse(publishedAt);
  return Number.isFinite(timestamp) && timestamp <= Date.parse(window.before) &&
    (!window.after || timestamp >= Date.parse(window.after));
}
