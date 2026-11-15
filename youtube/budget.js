const limits = { informative: 90 * 60_000, entertainment: 45 * 60_000 };
const storageKey = "youtube-playback-v1";
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", dateStyle: "short" });
const today = () => dateFormat.format(new Date());
const emptyDay = (day) => ({ day, informative: 0, entertainment: 0 });

function load(day = today()) {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  return saved?.day === day ? saved : emptyDay(day);
}

export function balance(category) {
  return Math.max(0, limits[category] - load()[category]);
}

export function watch(category, { start, update, end }) {
  if (!(category in limits) || !navigator.locks) throw new Error("Playback budgets require a current version of desktop Chrome.");
  let cancelled = false;
  let settle;
  let finish;
  const untilClosed = new Promise((resolve) => { finish = resolve; });
  const close = () => {
    if (cancelled) return;
    cancelled = true;
    try { settle?.(); } finally { finish(); }
  };

  void navigator.locks.request(storageKey, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Close the player in your other YouTube digest tab first.");
    if (cancelled) return;
    if (!balance(category)) throw new Error("You’ve used today’s " + category + " budget.");

    function reserve() {
      const day = today();
      const daily = load(day);
      const amount = Math.max(0, Math.min(5000, limits[category] - daily[category]));
      if (!amount) {
        close();
        return;
      }

      daily[category] += amount;
      localStorage.setItem(storageKey, JSON.stringify(daily));
      const started = performance.now();
      const timer = setTimeout(() => {
        settle = undefined;
        try { reserve(); } catch { close(); }
      }, amount);
      settle = () => {
        clearTimeout(timer);
        const unused = Math.max(0, Math.floor(amount - (performance.now() - started)));
        if (unused && today() === day) {
          daily[category] -= unused;
          localStorage.setItem(storageKey, JSON.stringify(daily));
        }
      };
      update();
    }

    try {
      reserve();
      if (!cancelled) start();
      await untilClosed;
    } finally {
      close();
    }
  }).then(() => end(), (error) => end(error));

  return close;
}
