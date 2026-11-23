import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { badgeOfProvider, build } from "./model.mjs";

const POLL_MS = 5 * 60 * 1000;
const OMP_TIMEOUT_MS = 90 * 1000;
const TERN_GRACE_MS = 2 * 60 * 1000;
const CHECK_MS = 20 * 1000;

function ompCandidates(env) {
	const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
	return ["omp", join(dataHome, "tern", "omp", "bin", "omp")];
}

function ternCachePath(env) {
	const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
	return join(stateHome, "tern", "plugin-data", "usage-rings", "kv.json");
}

function firstPrintedLine(output) {
	const printable = String(output ?? "").replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[^\n\x20-\x7e]/g, "");
	return printable.match(/([^\s][^\n]*)/)?.[1] ?? null;
}

export class Usage extends EventEmitter {
	constructor({ log, env = process.env, cachePath = ternCachePath(env) }) {
		super();
		this.log = log;
		this.env = env;
		this.cachePath = cachePath;
		this.reading = null;
		this.source = null;
		this.error = null;
		this.asking = false;
		this.lastAsked = 0;
		this.timer = null;
	}

	start() {
		if (this.timer) return;
		this.check();
		this.timer = setInterval(() => this.check(), CHECK_MS);
	}

	stop() {
		clearInterval(this.timer);
		this.timer = null;
	}

	states(now, placed = []) {
		return build({
			data: this.reading?.data ?? null,
			history: this.reading?.history ?? null,
			now,
			fetchedAt: this.reading?.at ?? null,
			loading: this.reading == null && this.error == null,
			error: this.error,
			placed,
		});
	}

	async ternReading() {
		try {
			const answer = JSON.parse(await readFile(this.cachePath, "utf8"))?.usage;
			return answer != null && typeof answer.at === "number" && answer.data != null ? answer : null;
		} catch {
			return null;
		}
	}

	async check() {
		const now = Date.now();
		const fromTern = await this.ternReading();
		if (fromTern != null && fromTern.at <= now && fromTern.at > (this.reading?.at ?? 0)) {
			if (this.source !== "tern") this.log("usage: showing the reading Tern's Usage Rings keeps");
			this.reading = fromTern;
			this.source = "tern";
			this.error = null;
			this.emit("change");
		}
		const age = now - (this.reading?.at ?? 0);
		if (age > POLL_MS + TERN_GRACE_MS && !this.asking && now - this.lastAsked >= POLL_MS) {
			this.lastAsked = now;
			await this.ask();
		}
	}

	async ask() {
		this.asking = true;
		try {
			const report = await this.omp(["usage", "--json"]);
			if (report.data == null) {
				this.error = report.error;
				this.log(`omp usage failed: ${report.error}`);
				this.emit("change");
				return;
			}
			const data = report.data;
			const missing = new Set(build({ data, now: Date.now() }).filter((state) => !state.hasLimits).map((state) => state.id));
			let history = null;
			if (missing.size > 0) {
				const recorded = (await this.omp(["usage", "--history", "--json", "-d", "1"])).data;
				if (recorded != null) {
					const badgeOf = badgeOfProvider(data);
					history = { entries: (recorded.entries ?? []).filter((entry) => missing.has(badgeOf(entry.provider))) };
				}
			}
			if (this.source !== "omp") this.log("usage: no current reading from Tern, asking omp directly");
			this.reading = { at: Date.now(), data, history };
			this.source = "omp";
			this.error = null;
			this.emit("change");
		} finally {
			this.asking = false;
		}
	}

	omp(args) {
		const candidates = ompCandidates(this.env);
		return new Promise((resolve) => {
			const attempt = (index) => {
				execFile(candidates[index], args, { env: this.env, timeout: OMP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
					if (error?.code === "ENOENT") {
						if (index + 1 < candidates.length) attempt(index + 1);
						else resolve({ data: null, error: "omp not found" });
					} else if (error?.killed) {
						resolve({ data: null, error: "omp timed out" });
					} else if (error) {
						resolve({ data: null, error: firstPrintedLine(stderr) ?? `exit ${error.code}` });
					} else {
						const start = String(stdout).indexOf("{");
						try {
							resolve({ data: JSON.parse(String(stdout).slice(start)), error: null });
						} catch {
							resolve({ data: null, error: "omp printed no JSON" });
						}
					}
				});
			};
			attempt(0);
		});
	}
}
