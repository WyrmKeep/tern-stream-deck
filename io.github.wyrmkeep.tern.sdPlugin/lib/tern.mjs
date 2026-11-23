import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";

const POLL_MS = 2000;
const COMMAND_TIMEOUT_MS = 5000;
const TERN_WINDOW_ICON = "so.stencil.tern";
const PANE_VARIABLES = ["TERN_PANE", "TERN_PANE_SOCKET", "TERN_WINDOW_KEY", "TERN_WINDOW_SOCKET", "TERN_PROMPT_FILE", "TERN_IDENTITY"];

function run(file, args, { env, timeout = COMMAND_TIMEOUT_MS } = {}) {
	return new Promise((resolve) => {
		execFile(file, args, { env, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
			resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), missing: error?.code === "ENOENT" });
		});
	});
}

export class Tern extends EventEmitter {
	constructor({ log, bin = "tern", pollMs = POLL_MS, env = process.env }) {
		super();
		this.log = log;
		this.bin = bin;
		this.pollMs = pollMs;
		this.env = { ...env };
		for (const name of PANE_VARIABLES) delete this.env[name];

		this.running = null;
		this.windowKey = null;
		this.sessions = [];
		this.panes = new Map();
		this.agents = new Map();
		this.lastTab = new Map();
		this.signature = "";
		this.timer = null;
		this.pending = null;
		this.again = false;
	}

	start() {
		if (this.timer) return;
		this.poll();
		this.timer = setInterval(() => this.poll(), this.pollMs);
	}

	stop() {
		clearInterval(this.timer);
		this.timer = null;
	}

	tern(command, args = [], options = {}) {
		const window = this.windowKey != null ? ["--window", this.windowKey] : [];
		return run(this.bin, [...command, ...window, ...args], { env: this.env, ...options });
	}

	async inspect() {
		const result = await this.tern(["inspect"], ["--json"]);
		if (!result.ok) return null;
		try {
			return JSON.parse(result.stdout);
		} catch {
			return null;
		}
	}

	poll() {
		if (this.pending) {
			this.again = true;
			return this.pending;
		}
		this.pending = this.pollOnce().finally(() => {
			this.pending = null;
			if (!this.again) return undefined;
			this.again = false;
			return this.poll();
		});
		return this.pending;
	}

	async pollOnce() {
		let report = await this.inspect();
		if (report != null) {
			const windows = (report.clients ?? []).filter((client) => client.kind === "window").map((client) => client.window);
			if (windows.length > 0 && !windows.includes(this.windowKey)) {
				this.windowKey = windows[0];
				this.log(`tern: following window ${JSON.stringify(this.windowKey)}`);
				report = (await this.inspect()) ?? report;
			}
		}
		this.take(report, Date.now());
	}

	take(report, now) {
		if (this.running !== (report != null)) this.log(report != null ? "tern: answering" : "tern: no answer (not running?)");
		this.running = report != null;
		this.sessions = report?.sessions ?? [];
		this.panes = new Map((report?.panes ?? []).map((pane) => [pane.pane, pane]));

		const displayed = new Set();
		for (const session of this.sessions) {
			if (!session.shown) continue;
			for (const tab of session.tabs ?? []) {
				if (!tab.shown) continue;
				this.lastTab.set(session.id, tab.id);
				for (const block of tab.blocks ?? []) displayed.add(block.id);
			}
		}

		for (const [id, pane] of this.panes) {
			const known = this.agents.get(id);
			const isAgent = pane.omp_session_file != null || pane.working === true || known != null;
			if (!isAgent) continue;
			let state = known?.state ?? "idle";
			if (pane.working === true) state = "working";
			else if (displayed.has(id)) state = "idle";
			else if (state === "working") state = "done";
			if (state !== known?.state) this.agents.set(id, { state, since: now });
		}
		for (const id of this.agents.keys()) if (!this.panes.has(id)) this.agents.delete(id);
		for (const id of this.lastTab.keys()) if (!this.sessions.some((session) => session.id === id)) this.lastTab.delete(id);

		const signature = JSON.stringify([this.running, this.sessionViews(), this.agentCounts()]);
		if (signature !== this.signature) {
			this.signature = signature;
			this.emit("change");
		}
	}

	sessionViews() {
		return this.sessions.map((session) => ({
			id: session.id,
			name: session.name,
			shown: session.shown === true,
			tabs: (session.tabs ?? []).length,
			agents: (session.tabs ?? []).flatMap((tab) => (tab.blocks ?? []).map((block) => this.agents.get(block.id)?.state).filter(Boolean)),
		}));
	}

	agentCounts() {
		const counts = { working: 0, done: 0, total: this.agents.size };
		for (const { state } of this.agents.values()) {
			if (state === "working") counts.working += 1;
			else if (state === "done") counts.done += 1;
		}
		return counts;
	}

	sessionFor({ name, slot }) {
		const views = this.sessionViews();
		if (typeof name === "string" && name !== "") return views.find((view) => view.name === name) ?? null;
		return views[(Number(slot) || 1) - 1] ?? null;
	}

	async focusBlock(block) {
		const result = await this.tern(["focus"], [String(block)]);
		if (!result.ok) this.log(`tern focus ${block} failed: ${result.stderr.trim().split("\n")[0]}`);
		await this.raise();
		await this.poll();
		return result.ok;
	}

	async showSession(id) {
		const session = this.sessions.find((candidate) => candidate.id === id);
		const tabs = session?.tabs ?? [];
		if (tabs.length === 0) return false;
		let tab;
		if (session.shown) {
			const current = tabs.findIndex((candidate) => candidate.shown);
			tab = tabs[(current + 1) % tabs.length];
		} else {
			tab = tabs.find((candidate) => candidate.id === this.lastTab.get(id)) ?? tabs[0];
		}
		const block = (tab.blocks ?? []).find((candidate) => candidate.focused) ?? tab.blocks?.[0];
		return block != null && (await this.focusBlock(block.id));
	}

	async jumpToDone() {
		let oldest = null;
		for (const [id, agent] of this.agents) {
			if (agent.state === "done" && (oldest == null || agent.since < oldest.since)) oldest = { id, since: agent.since };
		}
		return oldest != null && (await this.focusBlock(oldest.id));
	}

	async newTab(command) {
		const session = this.sessions.find((candidate) => candidate.shown);
		const tab = session?.tabs?.find((candidate) => candidate.shown);
		const front = (tab?.blocks ?? []).find((candidate) => candidate.focused) ?? tab?.blocks?.[0];
		const cwd = front?.cwd || homedir();
		const made = await this.tern(["new", "tab"], [...(session ? [String(session.id)] : []), "--cwd", cwd, "--json"]);
		let block = null;
		try {
			block = JSON.parse(made.stdout).block;
		} catch {
		}
		if (!made.ok || block == null) {
			this.log(`tern new tab failed: ${made.stderr.trim().split("\n")[0]}`);
			return false;
		}
		await this.tern(["focus"], [String(block)]);
		if (typeof command === "string" && command.trim() !== "") {
			await this.tern(["wait"], [String(block), "--until", "prompt", "--timeout", "5"], { timeout: 7000 });
			const typed = await this.tern(["run"], [String(block), command.trim()]);
			if (!typed.ok) this.log(`tern run failed: ${typed.stderr.trim().split("\n")[0]}`);
		}
		await this.raise();
		await this.poll();
		return true;
	}

	async raise() {
		const call = ["--user", "--json=short", "call", "org.kde.KWin", "/WindowsRunner", "org.kde.krunner1"];
		const found = await run("busctl", [...call, "Match", "s", "Tern"], { env: this.env });
		if (!found.ok) return false;
		let match;
		try {
			match = JSON.parse(found.stdout).data[0].find((entry) => entry[2] === TERN_WINDOW_ICON);
		} catch {
			return false;
		}
		if (!match) return false;
		return (await run("busctl", [...call, "Run", "ss", match[0], ""], { env: this.env })).ok;
	}
}
