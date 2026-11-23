const NBSP = "\u00A0";
const ZERO_WIDTH_SPACE = "\u200B";
const ELLIPSIS = "\u2026";
const MIDDLE_DOT = "\u00B7";

const EMPTY = Object.freeze(Object.create(null));

const isNil = (x) => x === null || x === undefined;
const truthy = (x) => x !== null && x !== undefined && x !== false;
const or = (a, b) => (truthy(a) ? a : b);
const nil = (x) => (x === undefined ? null : x);
const isTable = (x) => typeof x === "object" && x !== null;
const asNumber = (x) => (typeof x === "number" ? x : null);

function fromJson(value) {
  if (Array.isArray(value)) {
    return value.map(fromJson);
  }
  if (isTable(value)) {
    const table = Object.create(null);
    for (const key of Object.keys(value)) {
      const member = value[key];
      if (!isNil(member)) {
        table[key] = fromJson(member);
      }
    }
    return table;
  }
  return value;
}

function* ipairs(list) {
  if (!Array.isArray(list)) {
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (isNil(item)) {
      return;
    }
    yield item;
  }
}

function count(list) {
  if (!Array.isArray(list)) {
    return 0;
  }
  let j = list.length;
  if (j > 0 && isNil(list[j - 1])) {
    let i = 0;
    while (j - i > 1) {
      const m = Math.floor((i + j) / 2);
      if (isNil(list[m - 1])) {
        j = m;
      } else {
        i = m;
      }
    }
    return i;
  }
  return j;
}

function numToString(n) {
  if (Number.isNaN(n)) {
    return "nan";
  }
  if (n === Infinity) {
    return "inf";
  }
  if (n === -Infinity) {
    return "-inf";
  }
  if (Object.is(n, -0)) {
    return "-0";
  }
  return String(n).replace(/e([+-])(\d)$/, (_, sign, digit) => `e${sign}0${digit}`);
}

function luaToString(x) {
  if (typeof x === "string") {
    return x;
  }
  if (typeof x === "number") {
    return numToString(x);
  }
  if (isNil(x)) {
    return "nil";
  }
  if (typeof x === "boolean") {
    return x ? "true" : "false";
  }
  return "table";
}

const S = (x) => (typeof x === "string" ? x : typeof x === "number" ? numToString(x) : String(x));

const asciiLower = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
const asciiUpper = (s) => s.replace(/[a-z]+/g, (m) => m.toUpperCase());
const lower = (x) => asciiLower(S(x));

const SPACE_CLASS = " \\t\\n\\v\\f\\r";
const TRAILING_SPACE = new RegExp(`[${SPACE_CLASS}]+$`);
const KEY_SEPARATOR = new RegExp(`:[${SPACE_CLASS}]`, "g");
const ID_WORD = new RegExp(`[^\\-_${SPACE_CLASS}]+`, "g");
const HOURS_PREFIX = new RegExp(`^([0-9]+)[${SPACE_CLASS}]*h`);
const SEVEN_DAYS = new RegExp(`7[${SPACE_CLASS}]*d`);

function compareStrings(a, b) {
  if (a === b) {
    return 0;
  }
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x.done || y.done) {
      return x.done ? (y.done ? 0 : -1) : 1;
    }
    const c = x.value.codePointAt(0);
    const d = y.value.codePointAt(0);
    if (c !== d) {
      return c < d ? -1 : 1;
    }
  }
}

function lessThan(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return a < b;
  }
  return compareStrings(S(a), S(b)) < 0;
}
const sortOrder = (a, b) => (lessThan(a, b) ? -1 : lessThan(b, a) ? 1 : 0);

const lmod = (a, b) => a - Math.floor(a / b) * b;

function fmtD(x) {
  const whole = Math.trunc(x);
  if (!(whole >= -(2 ** 63) && whole < 2 ** 63)) {
    return "-9223372036854775808";
  }
  return BigInt(whole).toString();
}

function fmtF2(x) {
  if (Number.isInteger(x * 8) && lmod(x * 8, 2) === 1) {
    const scaled = x * 100;
    const low = Math.floor(scaled);
    const hundredths = lmod(low, 2) === 0 ? low : low + 1;
    return `${Math.floor(hundredths / 100)}.${String(lmod(hundredths, 100)).padStart(2, "0")}`;
  }
  return x.toFixed(2);
}

const cpLength = (s) => {
  let n = 0;
  for (const _ of s) {
    n++;
  }
  return n;
};

const startsWith = (s, prefix) => S(s).startsWith(prefix);

const KNOWN_BADGES = [
  { id: "claude", name: "Claude", icon: "provider:anthropic", prefixes: ["anthropic"] },
  { id: "codex", name: "Codex", icon: "provider:openai", prefixes: ["openai-codex"] },
  {
    id: "gemini",
    name: "Gemini",
    icon: "provider:google-gemini-cli",
    prefixes: ["google-antigravity", "google-gemini"],
    keepsLimit: (provider, limit) =>
      provider !== "google-antigravity" || startsWith(lower(or(limit.label, "")), "gemini"),
    ignoresCapacity: (provider) => provider === "google-antigravity",
  },
  { id: "opencode", name: "OpenCode", icon: "provider:opencode", prefixes: ["opencode"] },
  { id: "grok", name: "Grok", icon: "provider:xai", prefixes: ["xai"] },
];

function accepts(badge, provider) {
  for (const prefix of badge.prefixes ?? []) {
    if (startsWith(provider, prefix)) {
      return true;
    }
  }
  for (const exact of badge.providers ?? []) {
    if (provider === exact) {
      return true;
    }
  }
  return false;
}

function badgeFor(badges, provider) {
  if (typeof provider !== "string") {
    return null;
  }
  for (const badge of badges) {
    if (accepts(badge, provider)) {
      return badge;
    }
  }
  return null;
}

function capitalize(s) {
  const text = S(s);
  return asciiUpper(text.slice(0, 1)) + text.slice(1);
}

function titleCase(provider) {
  const words = [];
  for (const [word] of S(provider).matchAll(ID_WORD)) {
    words.push(capitalize(word));
  }
  return words.join(" ");
}

function widgetId(provider) {
  let id = lower(provider).replace(/[^a-z0-9]+/g, "-");
  if (!/^[a-z]/.test(id)) {
    id = "p-" + id;
  }
  return id.slice(0, 32);
}

function badgesFor(data, placed) {
  const badges = [];
  const taken = new Set();
  const providers = new Set();
  for (const badge of KNOWN_BADGES) {
    badges.push(badge);
    taken.add(badge.id);
  }
  for (const list of ["reports", "accountsWithoutUsage"]) {
    for (const item of ipairs(or(data, EMPTY)[list])) {
      if (typeof item.provider === "string" && item.provider !== "" && badgeFor(KNOWN_BADGES, item.provider) === null) {
        providers.add(item.provider);
      }
    }
  }
  const unknown = [...providers].sort(compareStrings);
  for (const id of ipairs(placed)) {
    unknown.push(id);
  }
  for (const provider of unknown) {
    const id = widgetId(provider);
    if (!taken.has(id)) {
      taken.add(id);
      badges.push({ id, name: titleCase(provider), icon: "provider:" + S(provider), providers: [provider] });
    }
  }
  return badges;
}

function clamp01(x) {
  const low = x < 1 ? x : 1;
  return low > 0 ? low : 0;
}

function percent(fraction) {
  return Math.floor(clamp01(fraction) * 100 + 0.5);
}

export function level(fraction) {
  if (isNil(fraction)) {
    return "off";
  } else if (fraction >= 0.95) {
    return "bad";
  } else if (fraction >= 0.8) {
    return "hot";
  } else if (fraction >= 0.5) {
    return "warn";
  }
  return "ok";
}

function padLeft(s, width) {
  return NBSP.repeat(Math.max(0, width - cpLength(s))) + s;
}

function padRight(s, width) {
  return s + NBSP.repeat(Math.max(0, width - cpLength(s)));
}

function truncate(s, length) {
  const text = S(s);
  const chars = Array.from(text);
  if (chars.length <= length) {
    return text;
  }
  return chars.slice(0, length - 1).join("").replace(TRAILING_SPACE, "") + ELLIPSIS;
}

const withoutKeySeparator = (s) => S(s).replace(KEY_SEPARATOR, ", ");

function plural(n, noun) {
  return `${fmtD(n)} ${noun}${n === 1 ? "" : "s"}`;
}

export function timeUntil(at, now) {
  if (isNil(at)) {
    return null;
  }
  const minutes = Math.floor((at - now) / 60000);
  if (minutes <= 0) {
    return "now";
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(lmod(minutes, 1440) / 60);
  if (days > 0) {
    return `${fmtD(days)}d${fmtD(hours)}h`;
  } else if (hours > 0) {
    return `${fmtD(hours)}h${fmtD(lmod(minutes, 60)).padStart(2, "0")}m`;
  }
  return `${fmtD(minutes)}m`;
}

function timeSince(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) {
    return "just now";
  } else if (minutes < 60) {
    return `${fmtD(minutes)} min ago`;
  } else if (minutes < 2880) {
    return `${fmtD(Math.floor(minutes / 60))} h ago`;
  }
  return `${fmtD(Math.floor(minutes / 1440))} d ago`;
}

function resetPhrase(resetsAt, now) {
  const reset = timeUntil(resetsAt, now);
  if (reset === null) {
    return null;
  } else if (reset === "now") {
    return "resets now";
  }
  return "resets in " + reset;
}

function alignedValue(used, resetsAt, now) {
  if (isNil(used)) {
    return "no data";
  }
  const tail = padRight((resetPhrase(resetsAt, now) ?? "no reset time").replaceAll(" ", NBSP), 16);
  return (
    ZERO_WIDTH_SPACE +
    padLeft(`${fmtD(percent(used))}%`, 4) +
    NBSP +
    MIDDLE_DOT +
    NBSP +
    tail +
    ZERO_WIDTH_SPACE
  );
}

function amountText(value, unit) {
  const size = Math.abs(value);
  const whole = size >= 100 || size === Math.floor(size);
  const number = whole ? fmtD(Math.floor(size + 0.5)) : fmtF2(size);
  const sign = value < 0 ? "-" : "";
  if (unit === "usd") {
    return sign + "$" + number;
  } else if (typeof unit === "string" && unit !== "" && unit !== "percent") {
    return sign + number + " " + unit;
  }
  return sign + number;
}

function normalWindow(id) {
  const lowered = lower(or(id, ""));
  const weeks = /^([0-9]+)w$/.exec(lowered);
  if (weeks) {
    return numToString(Number(weeks[1]) * 7) + "d";
  }
  return lowered;
}

function windowName(id, label, fallback) {
  const parts = /^([0-9]+)([hd])$/.exec(id);
  if (parts) {
    return parts[1] + parts[2];
  } else if (id === "monthly") {
    return "Monthly";
  } else if (!isNil(label) && label !== "") {
    return label;
  } else if (id !== "") {
    return id;
  }
  return fallback;
}

function windowIdFromLabel(label) {
  const lowered = lower(or(label, ""));
  const hours = HOURS_PREFIX.exec(lowered);
  if (hours) {
    return hours[1] + "h";
  } else if (lowered.includes("week") || SEVEN_DAYS.test(lowered)) {
    return "7d";
  } else if (lowered.includes("month")) {
    return "monthly";
  }
  return lowered;
}

function idWordsTheWindowOmits(id, window) {
  const said = lower(or(window, ""));
  const text = luaToString(or(id, ""));
  const words = [];
  for (const [word] of lower(text.slice(text.lastIndexOf(":") + 1)).matchAll(ID_WORD)) {
    if (!said.includes(word)) {
      words.push(word);
    }
  }
  return words;
}

function labelWordsTheWindowOmits(label, window) {
  const said = lower(or(window, ""));
  const words = [];
  for (const [word] of S(or(label, "")).matchAll(/[A-Za-z0-9]+/g)) {
    if (!said.includes(lower(word))) {
      words.push(word);
    }
  }
  return words.join(" ");
}

function usedFraction(amount) {
  if (isNil(amount)) {
    return null;
  } else if (typeof amount.usedFraction === "number") {
    return clamp01(amount.usedFraction);
  } else if (typeof amount.remainingFraction === "number") {
    return clamp01(1 - amount.remainingFraction);
  } else if (typeof amount.limit === "number" && amount.limit > 0) {
    if (typeof amount.used === "number") {
      return clamp01(amount.used / amount.limit);
    } else if (typeof amount.remaining === "number") {
      return clamp01(1 - amount.remaining / amount.limit);
    }
  }
  return null;
}

function countedUse(limit) {
  if (limit.status === "exhausted") {
    return 1;
  }
  return limit.used;
}

function emailName(account) {
  const email = account.email;
  if (typeof email === "string" && email !== "") {
    const local = /^([^@]+)/.exec(email);
    return truncate(local ? local[1] : email, 20);
  }
  return null;
}

function accountFromReport(report, badge) {
  const details = or(report.metadata, EMPTY);
  const plan = nil(or(details.subscriptionPlan, details.planType));
  const planWord = typeof plan === "string" ? lower(plan) : null;
  const limits = [];
  for (const limit of ipairs(report.limits)) {
    if (badge.keepsLimit === undefined || badge.keepsLimit(report.provider, limit)) {
      const window = isTable(limit.window) ? limit.window : EMPTY;
      const id = normalWindow(window.id);
      const windowWords = S(or(window.label, "")) + " " + S(or(window.id, "")) + " " + id;
      const rawTier = or(limit.scope, EMPTY).tier;
      const tier = typeof rawTier === "string" ? lower(rawTier) : null;
      const amount = isTable(limit.amount) ? limit.amount : EMPTY;
      const used = usedFraction(amount);
      const hasBalance = used === null && typeof amount.remaining === "number";
      limits.push({
        idWords: idWordsTheWindowOmits(limit.id, windowWords),
        remainder: labelWordsTheWindowOmits(limit.label, windowWords),
        window: id,
        name: windowName(id, window.label, or(limit.label, "Usage")),
        tier: tier !== planWord ? tier : null,
        used,
        left: hasBalance ? { amount: amount.remaining, unit: nil(amount.unit) } : null,
        status: nil(limit.status),
        resetsAt: asNumber(window.resetsAt),
      });
    }
  }
  return {
    name: emailName(details),
    credential: typeof details.credentialId === "number" ? details.credentialId : null,
    plan,
    limits,
  };
}

function accountsFromReport(data, badge, badges) {
  const accounts = [];
  const providers = new Set();
  for (const report of ipairs(data.reports)) {
    if (badgeFor(badges, report.provider) === badge) {
      providers.add(report.provider);
      const account = accountFromReport(report, badge);
      if (account.limits.length > 0 || count(report.limits) === 0) {
        accounts.push(account);
      }
    }
  }
  for (const account of ipairs(data.accountsWithoutUsage)) {
    if (badgeFor(badges, account.provider) === badge) {
      providers.add(account.provider);
      accounts.push({ name: emailName(account), credential: null, plan: null, limits: [] });
    }
  }
  return { accounts, providers };
}

function accountsFromHistory(history, badge, badges) {
  const byAccount = new Map();
  const order = [];
  for (const entry of ipairs(or(history, EMPTY).entries)) {
    if (
      badgeFor(badges, entry.provider) === badge &&
      (badge.keepsLimit === undefined || badge.keepsLimit(entry.provider, entry))
    ) {
      const key = or(or(or(entry.accountKey, entry.email), entry.accountId), "?");
      let account = byAccount.get(key);
      if (account === undefined) {
        account = { name: emailName(entry), limits: new Map() };
        byAccount.set(key, account);
        order.push(key);
      }
      const limitId = or(or(entry.limitId, entry.label), "?");
      const recordedAt = or(asNumber(entry.recordedAt), 0);
      const known = account.limits.get(limitId);
      if (known === undefined || recordedAt > known.recordedAt) {
        const window = windowIdFromLabel(entry.windowLabel);
        const windowWords = S(or(entry.windowLabel, "")) + " " + window;
        account.limits.set(limitId, {
          idWords: idWordsTheWindowOmits(entry.limitId, windowWords),
          remainder: labelWordsTheWindowOmits(entry.label, windowWords),
          order: luaToString(limitId),
          window,
          name: windowName(window, entry.windowLabel, or(entry.label, "Usage")),
          tier: null,
          used: typeof entry.usedFraction === "number" ? clamp01(entry.usedFraction) : null,
          left: null,
          status: nil(entry.status),
          resetsAt: asNumber(entry.resetsAt),
          recordedAt,
        });
      }
    }
  }
  const accounts = [];
  let newest = null;
  for (const key of order) {
    const limits = [];
    for (const limit of byAccount.get(key).limits.values()) {
      limits.push(limit);
      if (newest === null || limit.recordedAt > newest) {
        newest = limit.recordedAt;
      }
    }
    limits.sort((a, b) => {
      if (a.name !== b.name) {
        return sortOrder(a.name, b.name);
      } else if (a.idWords.length !== b.idWords.length) {
        return a.idWords.length < b.idWords.length ? -1 : 1;
      }
      return sortOrder(a.order, b.order);
    });
    accounts.push({ name: byAccount.get(key).name, credential: null, plan: null, limits });
  }
  return { accounts, newest };
}

function unusableCredentials(data, badge, badges) {
  const credentials = [];
  for (const credential of ipairs(data.disabledCredentials)) {
    if (badgeFor(badges, credential.provider) === badge) {
      const cause = lower(or(credential.cause, ""));
      const signedOut = cause.includes("refresh") || cause.includes("expired") || cause.includes("invalid_grant");
      credentials.push({ name: emailName(credential) ?? "An account", problem: signedOut ? "signed out" : "disabled" });
    }
  }
  return credentials;
}

function orderAndLabel(accounts) {
  let allHaveCredentials = accounts.length > 0;
  for (const account of accounts) {
    allHaveCredentials = allHaveCredentials && account.credential !== null;
  }
  if (allHaveCredentials) {
    accounts.sort((a, b) => sortOrder(a.credential, b.credential));
  }
  const uses = new Map();
  accounts.forEach((account, i) => {
    account.label = account.name !== null ? account.name : "Account " + (i + 1);
    uses.set(account.label, (uses.get(account.label) ?? 0) + 1);
  });
  accounts.forEach((account, i) => {
    if (uses.get(account.label) > 1) {
      account.label = `${account.label} (${i + 1})`;
    }
  });
}

function soonestReset(accounts, window, tier, now) {
  let soonest = null;
  for (const account of accounts) {
    for (const limit of account.limits) {
      const matches = limit.window === window && limit.tier === tier;
      if (matches && limit.resetsAt !== null && limit.resetsAt > now && (soonest === null || limit.resetsAt < soonest)) {
        soonest = limit.resetsAt;
      }
    }
  }
  return soonest;
}

function tiersOf(accounts) {
  const tiers = new Set();
  for (const account of accounts) {
    for (const limit of account.limits) {
      if (limit.tier !== null) {
        tiers.add(limit.tier);
      }
    }
  }
  return tiers;
}

function poolFromCapacity(data, providers, accounts, now) {
  const windows = [];
  const tiers = tiersOf(accounts);
  for (const provider of providers) {
    const capacities = isTable(data.capacity) ? data.capacity[provider] : undefined;
    for (const capacity of ipairs(capacities)) {
      if (typeof capacity.accounts === "number" && capacity.accounts > 0 && typeof capacity.usedAccounts === "number") {
        const meter = typeof capacity.meter === "string" ? lower(capacity.meter) : null;
        const tier = meter !== null && tiers.has(meter) ? meter : null;
        const window = normalWindow(capacity.window);
        const name = windowName(window, nil(capacity.window), "Usage");
        windows.push({
          name: tier !== null ? capitalize(tier) + " " + name : name,
          used: clamp01(capacity.usedAccounts / capacity.accounts),
          resetsAt: soonestReset(accounts, window, tier, now),
          narrow: tier !== null,
        });
      }
    }
  }
  return windows;
}

function poolFromLimits(accounts, now) {
  const groups = new Map();
  for (const account of accounts) {
    for (const limit of account.limits) {
      const used = countedUse(limit);
      if (used !== null) {
        let group = groups.get(limit.shown);
        if (group === undefined) {
          group = { narrow: limit.narrow, sum: 0, count: 0, resetsAt: null };
          groups.set(limit.shown, group);
        }
        group.sum += used;
        group.count += 1;
        if (limit.resetsAt !== null && limit.resetsAt > now && (group.resetsAt === null || limit.resetsAt < group.resetsAt)) {
          group.resetsAt = limit.resetsAt;
        }
      }
    }
  }
  const windows = [];
  for (const [name, group] of groups) {
    windows.push({ name, used: clamp01(group.sum / group.count), resetsAt: group.resetsAt, narrow: group.narrow });
  }
  return windows;
}

function poolOf(data, badge, providers, accounts, fromHistory, now) {
  if (accounts.length === 0) {
    return [];
  }
  let capacityCounts = !fromHistory;
  for (const provider of providers) {
    if (badge.ignoresCapacity !== undefined && badge.ignoresCapacity(provider)) {
      capacityCounts = false;
    }
  }
  let pool = capacityCounts ? poolFromCapacity(data, providers, accounts, now) : [];
  if (pool.length === 0) {
    pool = poolFromLimits(accounts, now);
  }
  return pool;
}

function tightestWindow(pool) {
  let tightest = null;
  let tightestOfAny = null;
  for (const window of pool) {
    if (tightestOfAny === null || window.used > tightestOfAny.used) {
      tightestOfAny = window;
    }
    if (!window.narrow && (tightest === null || window.used > tightest.used)) {
      tightest = window;
    }
  }
  return tightest ?? tightestOfAny;
}

function allDiffer(limits, field) {
  const seen = new Set();
  for (const limit of limits) {
    if (seen.has(limit[field])) {
      return false;
    }
    seen.add(limit[field]);
  }
  return true;
}

function setOwnWords(limits) {
  const holders = new Map();
  for (const limit of limits) {
    for (const word of limit.idWords) {
      holders.set(word, (holders.get(word) ?? 0) + 1);
    }
  }
  for (const limit of limits) {
    const own = [];
    for (const word of limit.idWords) {
      if (holders.get(word) < limits.length) {
        own.push(word);
      }
    }
    limit.distinction = own.join("-");
  }
}

function nameLimits(account) {
  const sharing = new Map();
  for (const limit of account.limits) {
    const key = S(limit.name) + "|" + (limit.tier ?? "");
    if (!sharing.has(key)) {
      sharing.set(key, []);
    }
    sharing.get(key).push(limit);
  }
  for (const sameName of sharing.values()) {
    let tellsApart = null;
    if (sameName.length > 1) {
      setOwnWords(sameName);
      tellsApart = allDiffer(sameName, "distinction") || !allDiffer(sameName, "remainder") ? "distinction" : "remainder";
    }
    for (const limit of sameName) {
      const suffix = tellsApart !== null ? limit[tellsApart] : "";
      const name = limit.tier !== null ? capitalize(limit.tier) + " " + S(limit.name) : limit.name;
      limit.shown = suffix !== "" ? S(name) + " " + suffix : name;
      limit.narrow = limit.tier !== null || suffix !== "";
    }
  }
}

function balanceLeft(accounts) {
  let total = null;
  let unit = null;
  for (const account of accounts) {
    for (const limit of account.limits) {
      if (limit.left !== null && (total === null || limit.left.unit === unit)) {
        total = (total ?? 0) + limit.left.amount;
        unit = limit.left.unit;
      }
    }
  }
  return total !== null ? { amount: total, unit } : null;
}

function loadingState(badge) {
  return {
    id: badge.id,
    name: badge.name,
    icon: badge.icon,
    summary: "reading omp",
    hasLimits: false,
    view: { text: ELLIPSIS, tone: "quiet", title: "Reading usage from omp" + ELLIPSIS },
    fill: null,
    level: "off",
    rows: [{}],
    pool: [],
  };
}

function stateFor(badge, badges, input) {
  const now = input.now;
  const data = nil(input.data);
  let accounts = [];
  let providers = new Set();
  let fromHistory = false;
  let newest = null;
  let unusable = [];
  if (data !== null) {
    ({ accounts, providers } = accountsFromReport(data, badge, badges));
    unusable = unusableCredentials(data, badge, badges);
  }
  let hasLimits = false;
  for (const account of accounts) {
    hasLimits = hasLimits || account.limits.length > 0;
  }
  if (!hasLimits && !isNil(input.history)) {
    const recorded = accountsFromHistory(input.history, badge, badges);
    if (recorded.accounts.length > 0) {
      accounts = recorded.accounts;
      newest = recorded.newest;
      fromHistory = true;
    }
  }
  orderAndLabel(accounts);
  for (const account of accounts) {
    nameLimits(account);
  }

  const pool = poolOf(data, badge, providers, accounts, fromHistory, now);
  const tightest = tightestWindow(pool);
  const used = tightest !== null ? tightest.used : null;
  const usedUp = used !== null && percent(used) >= 100;
  const left = used === null ? balanceLeft(accounts) : null;
  let text = "n/a";
  if (used !== null) {
    text = `${fmtD(percent(used))}%`;
    if (usedUp) {
      text = timeUntil(tightest.resetsAt, now) ?? text;
    }
  } else if (left !== null) {
    text = amountText(left.amount, left.unit === "usd" ? "usd" : null);
  }

  const hasError = !isNil(input.error);
  const flags = [];
  if (used === null && accounts.length === 0) {
    flags.push("quiet");
  }
  if (unusable.length > 0) {
    flags.push("dis");
  }
  if (fromHistory || hasError) {
    flags.push("old");
  }

  const lines = [];
  const rows = [];
  const heading = (line, row) => {
    lines.push(withoutKeySeparator(line));
    rows.push(row ?? {});
  };
  const meter = (name, fraction, resetsAt, balance) => {
    const value =
      balance !== null && balance !== undefined
        ? amountText(balance.amount, balance.unit) + NBSP + "left"
        : alignedValue(fraction, resetsAt, now);
    lines.push(withoutKeySeparator(truncate(name, 14)) + ": " + value);
    rows.push(
      balance !== null && balance !== undefined
        ? { bar: false }
        : { fill: fraction ?? 0, level: level(fraction) },
    );
  };
  if (accounts.length > 1 && pool.length > 0) {
    heading(`All ${fmtD(accounts.length)} accounts`);
    for (const window of pool) {
      meter(window.name, window.used, window.resetsAt, null);
    }
  }
  for (const account of accounts) {
    heading(account.plan !== null ? account.label + " " + MIDDLE_DOT + " " + capitalize(luaToString(account.plan)) : account.label);
    if (account.limits.length === 0) {
      meter("Usage", null, null, null);
    }
    for (const limit of account.limits) {
      meter(limit.shown, countedUse(limit), limit.resetsAt, limit.left);
    }
  }
  for (const credential of unusable) {
    heading(credential.name + " " + MIDDLE_DOT + " " + credential.problem + ", sign in again with omp", { dot: true });
  }
  if (accounts.length === 0 && unusable.length === 0) {
    heading("omp has no usage data for " + badge.name);
  }
  let footer = "Not read yet";
  if (fromHistory) {
    footer = "From omp's usage history" + ((newest ?? 0) > 0 ? ", " + timeSince(now - newest) : "");
  } else if (!isNil(input.fetched_at)) {
    footer = "Updated " + timeSince(now - input.fetched_at);
  }
  if (hasError) {
    footer = footer + " " + MIDDLE_DOT + " last refresh failed (" + truncate(input.error, 40) + ")";
  }
  heading(footer);

  let summary = "no account in omp";
  if (accounts.length > 0) {
    summary = plural(accounts.length, "account");
    if (usedUp && tightest.resetsAt !== null) {
      summary = summary + ", used up, " + resetPhrase(tightest.resetsAt, now);
    } else if (used !== null) {
      summary = summary + `, ${fmtD(percent(used))}% used`;
    } else if (left !== null) {
      summary = summary + ", " + amountText(left.amount, left.unit) + " left";
    } else {
      summary = summary + ", no usage data";
    }
  }
  if (unusable.length > 0) {
    summary = (accounts.length > 0 ? summary + ", " : "") + fmtD(unusable.length) + " signed out";
  }

  return {
    id: badge.id,
    name: badge.name,
    icon: badge.icon,
    summary,
    hasLimits,
    view: { text, tone: flags.length > 0 ? flags.join(" ") : null, title: lines.join("\n") },
    fill: used,
    level: left !== null ? "ok" : level(used),
    rows,
    pool: pool.map((window) => ({
      name: window.name,
      used: window.used,
      resetsAt: window.resetsAt,
      narrow: window.narrow,
      tightest: window === tightest,
    })),
  };
}

export function build(input) {
  const model = {
    data: fromJson(input.data),
    history: fromJson(input.history),
    now: input.now,
    fetched_at: nil(input.fetchedAt),
    loading: nil(input.loading),
    error: nil(fromJson(input.error)),
  };
  const placed = fromJson(input.placed);
  const badges = badgesFor(model.data, placed);
  return badges.map((badge) => (truthy(model.loading) ? loadingState(badge) : stateFor(badge, badges, model)));
}

export function badgeOfProvider(data) {
  const badges = badgesFor(fromJson(data), null);
  return (provider) => {
    const badge = badgeFor(badges, provider);
    return badge !== null ? badge.id : null;
  };
}
