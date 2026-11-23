import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as draw from "./lib/draw.mjs";
import { Tern } from "./lib/tern.mjs";
import { Usage } from "./lib/usage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = "io.github.wyrmkeep.tern.";
const DETAIL_MS = 12 * 1000;
const TICK_MS = 30 * 1000;
const RING_FACES = ["ring", "used", "resets"];

function argument(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

const port = argument("-port");
const pluginUuid = argument("-pluginUUID");
const registerEvent = argument("-registerEvent");
if (!port || !pluginUuid || !registerEvent) {
	console.error("usage: plugin.mjs -port PORT -pluginUUID UUID -registerEvent EVENT [-info JSON]");
	process.exit(2);
}
if (typeof WebSocket !== "function") {
	console.error(`Node.js 22 or later is needed; this is ${process.version}`);
	process.exit(1);
}

const icons = draw.loadIcons(join(HERE, "icons", "providers"));
const usage = new Usage({ log });
const tern = new Tern({ log });

const instances = new Map();
let rings = new Map();

const socket = new WebSocket(`ws://127.0.0.1:${port}`);
const send = (message) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(message));

const ofKind = (kind) => [...instances].filter(([, instance]) => instance.kind === kind);
const providerOf = (settings) => (typeof settings?.provider === "string" && settings.provider !== "" ? settings.provider : "claude");
const commandOf = (settings) => (typeof settings?.command === "string" ? settings.command.trim() : "");

function face(instance) {
	switch (instance.kind) {
		case "ring": {
			const state = rings.get(providerOf(instance.settings));
			if (state == null) return draw.emptyFace(providerOf(instance.settings));
			const which = state.pool.length > 0 ? RING_FACES[instance.face] : "ring";
			return which === "ring" ? draw.ringFace(state, icons) : draw.windowsFace(state, which, Date.now());
		}
		case "session": {
			if (tern.running == null) return null;
			if (!tern.running) return draw.emptyFace("Tern off");
			const session = tern.sessionFor(instance.settings);
			return session ? draw.sessionFace(session) : draw.emptyFace(instance.settings?.name || "–");
		}
		case "agents":
			if (tern.running == null) return null;
			return tern.running ? draw.agentsFace(tern.agentCounts()) : draw.emptyFace("Tern off");
		case "newtab": {
			const command = commandOf(instance.settings);
			return draw.newTabFace({ label: command === "" ? "shell" : command.split(/\s+/)[0].split("/").pop(), accent: command !== "" });
		}
		default:
			return draw.emptyFace("?");
	}
}

function render(context) {
	const instance = instances.get(context);
	if (!instance) return;
	const image = face(instance);
	if (image == null || image === instance.sent) return;
	instance.sent = image;
	send({ event: "setImage", context, payload: { image: draw.toDataUri(image) } });
}

function renderRings() {
	const placed = [...new Set(ofKind("ring").map(([, instance]) => providerOf(instance.settings)))];
	rings = new Map(usage.states(Date.now(), placed).map((state) => [state.id, state]));
	for (const [context] of ofKind("ring")) render(context);
}

function renderTern() {
	for (const [context, instance] of instances) if (instance.kind !== "ring") render(context);
}

function settle() {
	if (ofKind("ring").length > 0) usage.start();
	else usage.stop();
	if (instances.size > ofKind("ring").length) tern.start();
	else tern.stop();
}

usage.on("change", renderRings);
tern.on("change", renderTern);
setInterval(renderRings, TICK_MS);

function showRingFace(context, index) {
	const instance = instances.get(context);
	if (!instance) return;
	clearTimeout(instance.faceTimer);
	instance.face = index;
	if (index !== 0) instance.faceTimer = setTimeout(() => showRingFace(context, 0), DETAIL_MS);
	render(context);
}

async function press(context) {
	const instance = instances.get(context);
	if (!instance) return;
	switch (instance.kind) {
		case "ring":
			showRingFace(context, (instance.face + 1) % RING_FACES.length);
			return;
		case "session": {
			const session = tern.sessionFor(instance.settings);
			if (!session || !(await tern.showSession(session.id))) send({ event: "showAlert", context });
			return;
		}
		case "agents":
			await tern.jumpToDone();
			return;
		case "newtab":
			send({ event: (await tern.newTab(commandOf(instance.settings))) ? "showOk" : "showAlert", context });
			return;
	}
}

function choices(kind) {
	if (kind === "ring") return { providers: usage.states(Date.now()).map((state) => ({ id: state.id, name: state.name })) };
	if (kind === "session") return { sessions: tern.sessionViews().map((session) => session.name) };
	return {};
}

socket.addEventListener("open", () => {
	send({ event: registerEvent, uuid: pluginUuid });
	log(`registered as ${pluginUuid} on port ${port}`);
});

socket.addEventListener("message", ({ data }) => {
	let message;
	try {
		message = JSON.parse(data);
	} catch {
		return;
	}
	const { event, context, action } = message;
	switch (event) {
		case "willAppear": {
			const kind = String(action).startsWith(PREFIX) ? String(action).slice(PREFIX.length) : "?";
			instances.set(context, { kind, settings: message.payload?.settings ?? {}, face: 0, faceTimer: null, sent: null });
			settle();
			if (kind === "ring") renderRings();
			else render(context);
			break;
		}
		case "willDisappear":
			clearTimeout(instances.get(context)?.faceTimer);
			instances.delete(context);
			settle();
			break;
		case "didReceiveSettings": {
			const instance = instances.get(context);
			if (!instance) break;
			instance.settings = message.payload?.settings ?? {};
			if (instance.kind === "ring") renderRings();
			else render(context);
			break;
		}
		case "keyDown":
			press(context).catch((error) => log(`press failed: ${error?.stack ?? error}`));
			break;
		case "propertyInspectorDidAppear": {
			const instance = instances.get(context);
			if (instance) send({ event: "sendToPropertyInspector", context, payload: choices(instance.kind) });
			break;
		}
	}
});

socket.addEventListener("close", () => {
	log("OpenDeck closed the connection");
	process.exit(0);
});
socket.addEventListener("error", (event) => {
	log(`socket error: ${event?.message ?? "connection failed"}`);
	process.exit(1);
});

process.on("unhandledRejection", (error) => log(`unhandled: ${error?.stack ?? error}`));
