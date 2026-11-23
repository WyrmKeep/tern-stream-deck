import assert from "node:assert/strict";
import test from "node:test";

import { Tern } from "../io.github.wyrmkeep.tern.sdPlugin/lib/tern.mjs";

function report({ shown = [1, 11], working = [], without = [] } = {}) {
	const [shownSession, shownTab] = shown;
	const tab = (session, id, number, blocks) => ({
		id,
		number,
		shown: session === shownSession && id === shownTab,
		blocks: blocks.filter((block) => !without.includes(block)).map((block) => ({ id: block, focused: true, cwd: `/dir/${block}` })),
	});
	return {
		clients: [],
		sessions: [
			{ id: 1, name: "A", shown: shownSession === 1, tabs: [tab(1, 11, 1, [101]), tab(1, 12, 2, [102])] },
			{ id: 2, name: "B", shown: shownSession === 2, tabs: [tab(2, 21, 1, [201, 202])] },
		],
		panes: [101, 102, 201, 202]
			.filter((pane) => !without.includes(pane))
			.map((pane) => ({ pane, omp_session_file: pane === 202 ? null : `/sessions/${pane}.jsonl`, working: working.includes(pane) })),
	};
}

const tern = () => new Tern({ log: () => {} });
const dots = (subject, name) => subject.sessionFor({ name }).agents;

test("a chat that finishes off screen is done until its tab is shown", () => {
	const subject = tern();
	subject.take(report({ working: [201] }), 1000);
	assert.deepEqual(dots(subject, "B"), ["working"]);
	assert.deepEqual(subject.agentCounts(), { working: 1, done: 0, total: 3 });

	subject.take(report({ working: [] }), 2000);
	assert.deepEqual(dots(subject, "B"), ["done"]);
	assert.deepEqual(subject.agentCounts(), { working: 0, done: 1, total: 3 });

	subject.take(report({ shown: [2, 21] }), 3000);
	assert.deepEqual(dots(subject, "B"), ["idle"]);
	assert.equal(subject.agentCounts().done, 0);
});

test("a chat that finishes on screen was seen: it goes straight to idle", () => {
	const subject = tern();
	subject.take(report({ shown: [1, 11], working: [101] }), 1000);
	subject.take(report({ shown: [1, 11], working: [] }), 2000);
	assert.deepEqual(dots(subject, "A"), ["idle", "idle"]);
});

test("another tab of the shown session is not on screen", () => {
	const subject = tern();
	subject.take(report({ shown: [1, 11], working: [102] }), 1000);
	subject.take(report({ shown: [1, 11], working: [] }), 2000);
	assert.deepEqual(dots(subject, "A"), ["idle", "done"]);
});

test("a plain shell has no dot; a pane that worked once keeps one", () => {
	const subject = tern();
	subject.take(report(), 1000);
	assert.deepEqual(dots(subject, "B"), ["idle"]);
	subject.take(report({ working: [202] }), 2000);
	subject.take(report(), 3000);
	assert.deepEqual(dots(subject, "B"), ["idle", "done"]);
});

test("a closed chat is forgotten", () => {
	const subject = tern();
	subject.take(report({ working: [201] }), 1000);
	subject.take(report({ without: [201] }), 2000);
	assert.deepEqual(subject.agentCounts(), { working: 0, done: 0, total: 2 });
	assert.deepEqual(dots(subject, "B"), []);
});

test("the oldest finished chat is the one to jump to", async () => {
	const subject = tern();
	const focused = [];
	subject.focusBlock = async (block) => focused.push(block);
	subject.take(report({ shown: [1, 11], working: [102, 201] }), 1000);
	subject.take(report({ shown: [1, 11], working: [102] }), 2000);
	subject.take(report({ shown: [1, 11], working: [] }), 3000);
	await subject.jumpToDone();
	assert.deepEqual(focused, [201]);
});

test("a key finds its session by place or by name", () => {
	const subject = tern();
	subject.take(report(), 1000);
	assert.equal(subject.sessionFor({ slot: 2 }).name, "B");
	assert.equal(subject.sessionFor({}).name, "A");
	assert.equal(subject.sessionFor({ name: "B", slot: 1 }).name, "B");
	assert.equal(subject.sessionFor({ slot: 3 }), null);
	assert.equal(subject.sessionFor({ name: "gone" }), null);
});

test("change fires when a key would look different, and only then", () => {
	const subject = tern();
	let changes = 0;
	subject.on("change", () => changes++);
	subject.take(report(), 1000);
	subject.take(report(), 2000);
	assert.equal(changes, 1);
	subject.take(report({ working: [101] }), 3000);
	assert.equal(changes, 2);
	subject.take(null, 4000);
	assert.equal(changes, 3);
	assert.equal(subject.running, false);
});
