import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, badgeOfProvider, level, timeUntil } from "../io.github.wyrmkeep.tern.sdPlugin/lib/model.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const DUMP = path.join(HERE, "luau-dump.luau");

const lune = process.env.LUNE || "lune";
const modelPath =
  process.env.USAGE_RINGS_MODEL ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "tern", "plugins", "usage-rings", "lib", "model.luau");
const LIVE_STORE = path.join(
  process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"),
  "tern",
  "plugin-data",
  "usage-rings",
  "kv.json",
);

function runs(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

const missing = [];
if (!runs(lune)) {
  missing.push(`lune did not run as "${lune}" (install lune 0.10 or later, or set LUNE)`);
}
if (!existsSync(modelPath)) {
  missing.push(`Luau model not found at ${modelPath} (set USAGE_RINGS_MODEL)`);
}
const skipLuau = missing.length > 0 ? missing.join("; ") : false;

const TOLERANCE = 1e-9;

function runLuau(fixturePath, stdin) {
  const output = execFileSync(lune, ["run", DUMP, modelPath, fixturePath], {
    encoding: "utf8",
    input: stdin,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function runJs(input) {
  return build({
    data: input.data,
    history: input.history,
    now: input.now,
    fetchedAt: input.fetched_at,
    loading: input.loading,
    error: input.error,
    placed: input.placed,
  });
}

const isNil = (x) => x === null || x === undefined;

function compare(actual, expected, where, diffs) {
  if (isNil(actual) && isNil(expected)) {
    return;
  }
  if (typeof actual === "number" && typeof expected === "number") {
    if (!(Math.abs(actual - expected) <= TOLERANCE) && actual !== expected) {
      diffs.push(`${where}: js ${actual} != luau ${expected}`);
    }
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      diffs.push(`${where}: js has ${actual.length} entries, luau ${expected.length}`);
    }
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
      compare(actual[i], expected[i], `${where}[${i}]`, diffs);
    }
    return;
  }
  if (
    typeof actual === "object" && typeof expected === "object" &&
    actual !== null && expected !== null && !Array.isArray(actual) && !Array.isArray(expected)
  ) {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      compare(actual[key], expected[key], `${where}.${key}`, diffs);
    }
    return;
  }
  if (actual !== expected) {
    diffs.push(`${where}: js ${JSON.stringify(actual)} != luau ${JSON.stringify(expected)}`);
  }
}

const fromJs = (state) => ({
  id: state.id,
  name: state.name,
  icon: state.icon,
  summary: state.summary,
  has_limits: state.hasLimits,
  view: { text: state.view.text, tone: state.view.tone, title: state.view.title },
  fill: state.fill,
  level: state.level,
  rows: state.rows,
});
const fromLuau = (state) => ({
  id: state.id,
  name: state.name,
  icon: state.icon,
  summary: state.summary,
  has_limits: state.has_limits,
  view: { text: state.view.text, tone: state.view.tone, title: state.view.title },
  fill: state.fill,
  level: state.level,
  rows: state.rows,
});

function assertSameAsLuau(input, luauStates, label) {
  const jsStates = runJs(input);
  const diffs = [];
  compare(jsStates.map(fromJs), luauStates.map(fromLuau), "states", diffs);
  assert.equal(
    diffs.length,
    0,
    `${label}: the JS model differs from the Luau model in ${diffs.length} place(s):\n${diffs.slice(0, 25).join("\n")}`,
  );
  assertPoolInvariants(jsStates, label);
  return jsStates;
}

function assertPoolInvariants(states, label) {
  for (const state of states) {
    const where = `${label}: ${state.id}`;
    assert.ok(Array.isArray(state.pool), `${where}: pool is an array`);
    const tightest = state.pool.filter((window) => window.tightest);
    assert.ok(tightest.length <= 1, `${where}: at most one tightest window, got ${tightest.length}`);
    for (const window of state.pool) {
      assert.equal(typeof window.name, "string", `${where}: pool name`);
      assert.equal(typeof window.used, "number", `${where}: pool used`);
      assert.ok(window.used >= 0 && window.used <= 1, `${where}: pool used within 0..1`);
      assert.ok(window.resetsAt === null || typeof window.resetsAt === "number", `${where}: pool resetsAt`);
      assert.equal(typeof window.narrow, "boolean", `${where}: pool narrow`);
      assert.equal(typeof window.tightest, "boolean", `${where}: pool tightest`);
    }
    if (state.fill !== null) {
      assert.equal(tightest.length, 1, `${where}: fill is set, so one window is the tightest`);
      assert.equal(tightest[0].used, state.fill, `${where}: the tightest window's used equals fill`);
    } else {
      assert.equal(tightest.length, 0, `${where}: no fill, no tightest window`);
    }
  }
}

const fixtureFiles = readdirSync(FIXTURES).filter((file) => file.endsWith(".json")).sort();

describe("JS model equals Luau model", () => {
  test("fixtures exist", () => {
    assert.ok(fixtureFiles.length > 0, `no fixtures in ${FIXTURES}`);
  });

  for (const file of fixtureFiles) {
    const fixturePath = path.join(FIXTURES, file);
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    test(`${file}: ${fixture.name}`, { skip: skipLuau }, () => {
      assertSameAsLuau(fixture.input, runLuau(fixturePath), file);
    });
  }

  const liveSkip = skipLuau || (existsSync(LIVE_STORE) ? false : `no live store at ${LIVE_STORE}`);
  test("live Tern store: usage data", { skip: liveSkip }, (t) => {
    const usage = JSON.parse(readFileSync(LIVE_STORE, "utf8")).usage;
    if (usage === null || typeof usage !== "object" || typeof usage.at !== "number") {
      t.skip(`${LIVE_STORE} has no usable "usage" entry`);
      return;
    }
    const input = { data: usage.data, history: usage.history, now: usage.at + 60_000, fetched_at: usage.at };
    const luauStates = runLuau("-", JSON.stringify({ name: "live", input }));
    assert.ok(luauStates.length >= 5, "the live data yields the five known badges at least");
    assertSameAsLuau(input, luauStates, "live");
  });
});

describe("model.mjs", () => {
  test("level thresholds", () => {
    assert.equal(level(null), "off");
    assert.equal(level(undefined), "off");
    assert.equal(level(0), "ok");
    assert.equal(level(0.4999), "ok");
    assert.equal(level(0.5), "warn");
    assert.equal(level(0.7999), "warn");
    assert.equal(level(0.8), "hot");
    assert.equal(level(0.9499), "hot");
    assert.equal(level(0.95), "bad");
    assert.equal(level(1), "bad");
  });

  test("timeUntil", () => {
    const now = 1_000_000_000_000;
    const MIN = 60_000;
    assert.equal(timeUntil(null, now), null);
    assert.equal(timeUntil(undefined, now), null);
    assert.equal(timeUntil(now - 5 * MIN, now), "now");
    assert.equal(timeUntil(now, now), "now");
    assert.equal(timeUntil(now + 59_999, now), "now");
    assert.equal(timeUntil(now + MIN, now), "1m");
    assert.equal(timeUntil(now + 59 * MIN, now), "59m");
    assert.equal(timeUntil(now + 60 * MIN, now), "1h00m");
    assert.equal(timeUntil(now + 61 * MIN, now), "1h01m");
    assert.equal(timeUntil(now + 9 * 60 * MIN + 5 * MIN, now), "9h05m");
    assert.equal(timeUntil(now + 23 * 60 * MIN + 59 * MIN, now), "23h59m");
    assert.equal(timeUntil(now + 24 * 60 * MIN, now), "1d0h");
    assert.equal(timeUntil(now + 25 * 60 * MIN + 30 * MIN, now), "1d1h");
    assert.equal(timeUntil(now + 400 * 24 * 60 * MIN, now), "400d0h");
  });

  test("badgeOfProvider maps providers to badge ids like the Luau closure", () => {
    const data = {
      reports: [
        { provider: "anthropic" },
        { provider: "anthropic-bedrock" },
        { provider: "openai-codex" },
        { provider: "google-antigravity" },
        { provider: "google-gemini-cli" },
        { provider: "opencode-go" },
        { provider: "xai-oauth" },
        { provider: "runinfra" },
        { provider: "Weird_Provider X" },
        { provider: "foo-bar" },
        { provider: "foo_bar" },
        { provider: "Claude" },
      ],
      accountsWithoutUsage: [{ provider: "kimi-code" }],
    };
    const badgeOf = badgeOfProvider(data);
    assert.equal(badgeOf("anthropic"), "claude");
    assert.equal(badgeOf("anthropic-bedrock"), "claude");
    assert.equal(badgeOf("openai-codex"), "codex");
    assert.equal(badgeOf("openai"), null);
    assert.equal(badgeOf("google-antigravity"), "gemini");
    assert.equal(badgeOf("google-gemini-cli"), "gemini");
    assert.equal(badgeOf("opencode-go"), "opencode");
    assert.equal(badgeOf("xai-oauth"), "grok");
    assert.equal(badgeOf("runinfra"), "runinfra");
    assert.equal(badgeOf("kimi-code"), "kimi-code");
    assert.equal(badgeOf("Weird_Provider X"), "weird-provider-x");
    assert.equal(badgeOf("foo-bar"), "foo-bar");
    assert.equal(badgeOf("foo_bar"), null, "the later of two providers with one widget id gets no badge");
    assert.equal(badgeOf("Claude"), null, "a provider whose id is taken gets no badge");
    assert.equal(badgeOf("never-seen"), null);
    assert.equal(badgeOf(null), null);
    assert.equal(badgeOf(undefined), null);
    assert.equal(badgeOf(5), null);
    assert.equal(badgeOfProvider(null)("anthropic"), "claude");
    assert.equal(badgeOfProvider(undefined)("runinfra"), null);
  });

  test("badgeOfProvider only returns ids that build() produces", () => {
    for (const file of fixtureFiles) {
      const { input } = JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8"));
      if (input.data === null || typeof input.data !== "object") {
        continue;
      }
      const ids = new Set(build({ data: input.data, now: input.now }).map((state) => state.id));
      const badgeOf = badgeOfProvider(input.data);
      for (const list of ["reports", "accountsWithoutUsage", "disabledCredentials"]) {
        for (const item of Array.isArray(input.data[list]) ? input.data[list] : []) {
          const id = badgeOf(item?.provider);
          assert.ok(id === null || ids.has(id), `${file}: ${item?.provider} -> ${id}`);
        }
      }
    }
  });

  test("build is pure: no input mutation, repeatable", () => {
    for (const file of fixtureFiles) {
      const { input } = JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8"));
      const before = JSON.stringify(input);
      const first = runJs(input);
      const second = runJs(input);
      assert.equal(JSON.stringify(input), before, `${file}: input unchanged`);
      assert.deepEqual(first, second, `${file}: same output twice`);
    }
  });

  test("null and undefined are both nil", () => {
    const base = { now: 1_795_459_100_000 };
    const withNull = build({ ...base, data: null, history: null, fetchedAt: null, loading: null, error: null, placed: null });
    const withUndefined = build({ ...base });
    assert.deepEqual(withNull, withUndefined);
    assert.equal(withNull.length, 5);
    assert.deepEqual(
      withNull.map((state) => state.id),
      ["claude", "codex", "gemini", "opencode", "grok"],
    );
    assert.equal(withNull[0].summary, "no account in omp");
    assert.equal(withNull[0].view.text, "n/a");
    assert.equal(withNull[0].view.tone, "quiet");
    assert.equal(withNull[0].fill, null);
    assert.deepEqual(withNull[0].pool, []);
  });

  test("loading state", () => {
    const [claude] = build({ now: 0, loading: true, data: { reports: [] } });
    assert.deepEqual(claude, {
      id: "claude",
      name: "Claude",
      icon: "provider:anthropic",
      summary: "reading omp",
      hasLimits: false,
      view: { text: "\u2026", tone: "quiet", title: "Reading usage from omp\u2026" },
      fill: null,
      level: "off",
      rows: [{}],
      pool: [],
    });
  });

  test("view.title carries NBSP and zero-width spaces in the aligned meters", () => {
    const now = 1_795_459_100_000;
    const [claude] = build({
      now,
      data: {
        reports: [
          {
            provider: "anthropic",
            limits: [
              {
                id: "anthropic:7d",
                label: "Claude 7 Day",
                window: { id: "7d", label: "7 Day", resetsAt: now + 3 * 3_600_000 },
                amount: { usedFraction: 0.07 },
              },
            ],
            metadata: { email: "alex@example.com" },
          },
        ],
      },
    });
    const meter = claude.view.title.split("\n")[1];
    assert.equal(
      meter,
      "7d: \u200B" + "\u00A0\u00A0" + "7%" + "\u00A0\u00B7\u00A0" + "resets\u00A0in\u00A03h00m" + "\u00A0".repeat(16 - "resets in 3h00m".length) + "\u200B",
    );
  });
});
