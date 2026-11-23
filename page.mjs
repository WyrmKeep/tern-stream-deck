#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { navFace, toDataUri } from "./io.github.wyrmkeep.tern.sdPlugin/lib/draw.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = "io.github.wyrmkeep.tern.sdPlugin";
const STARTER = "com.amansprojects.starterpack.sdPlugin";
const PAGE = "Tern";
const KEYS = 15;

const LAYOUT = [
	["ring", { provider: "claude" }],
	["ring", { provider: "codex" }],
	["ring", { provider: "gemini" }],
	["ring", { provider: "opencode" }],
	["ring", { provider: "grok" }],
	["session", { slot: 1 }],
	["session", { slot: 2 }],
	["session", { slot: 3 }],
	["session", { slot: 4 }],
	["session", { slot: 5 }],
	["agents", {}],
	["newtab", { command: "omp" }],
	["newtab", { command: "" }],
	null,
	["back", {}],
];

const args = process.argv.slice(2);
const configDir = args.find((arg) => !arg.startsWith("--"));
const select = args.includes("--select");
const deviceArg = args.includes("--device") ? args[args.indexOf("--device") + 1] : null;
if (!configDir || !existsSync(join(configDir, "profiles"))) {
	console.error("usage: page.mjs CONFIG_DIR [--device ID] [--select]   (CONFIG_DIR holds profiles/ and plugins/)");
	process.exit(2);
}

const profilesDir = join(configDir, "profiles");
const devices = readdirSync(profilesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const device = deviceArg ?? (devices.length === 1 ? devices[0] : null);
if (!device || !devices.includes(device)) {
	console.error(`page.mjs: name the device with --device; OpenDeck knows: ${devices.join(", ") || "none (start OpenDeck once with the deck plugged in)"}`);
	process.exit(2);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
function backup(path) {
	if (!existsSync(path)) return;
	copyFileSync(path, `${path}.bak-${stamp}`);
	console.log(`backup: ${path}.bak-${stamp}`);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

function iconPath(pluginDir, plugin, name) {
	for (const suffix of [".svg", "@2x.png", ".png"]) {
		if (existsSync(join(pluginDir, name + suffix))) return `plugins/${plugin}/${name}${suffix}`;
	}
	return `plugins/${plugin}/${name}.png`;
}

function state(image, overrides = {}) {
	return {
		image,
		image_override: null,
		image_scale: 100,
		background_colour: "#000000",
		name: "",
		text: "",
		text_override: null,
		show: true,
		colour: "#FFFFFF",
		stroke_colour: "#000000",
		alignment: "middle",
		family: "Liberation Sans",
		style: "Regular",
		size: 16,
		stroke_size: 3,
		underline: false,
		...overrides,
	};
}

function action(plugin, uuid) {
	const pluginDir = join(configDir, "plugins", plugin);
	const manifest = readJson(join(pluginDir, "manifest.json"));
	const declared = manifest.Actions.find((candidate) => candidate.UUID === uuid);
	if (!declared) throw new Error(`${plugin} has no action ${uuid}`);
	const icon = iconPath(pluginDir, plugin, declared.Icon);
	const inspector = declared.PropertyInspectorPath ?? manifest.PropertyInspectorPath;
	return {
		name: declared.Name,
		uuid,
		plugin,
		tooltip: declared.Tooltip ?? "",
		icon,
		disable_automatic_states: declared.DisableAutomaticStates ?? false,
		visible_in_action_list: declared.VisibleInActionsList ?? true,
		supported_in_multi_actions: declared.SupportedInMultiActions ?? true,
		property_inspector: inspector ? `plugins/${plugin}/${inspector}` : "",
		controllers: declared.Controllers ?? ["Keypad"],
		encoder: null,
		states: declared.States.map((declaredState) =>
			state(declaredState.Image === "actionDefaultImage" || !declaredState.Image ? icon : iconPath(pluginDir, plugin, declaredState.Image), {
				show: declaredState.ShowTitle ?? true,
			}),
		),
	};
}

function instance(position, plugin, uuid, settings, stateOverrides = {}) {
	const stored = action(plugin, uuid);
	return {
		action: stored,
		context: `Keypad.${position}.0`,
		states: stored.states.map((actionState) => ({ ...actionState, ...stateOverrides })),
		current_state: 0,
		settings,
		children: null,
	};
}

const ternKey = (position, kind, settings) => instance(position, PLUGIN, `io.github.wyrmkeep.tern.${kind}`, settings);

function switchKey(position, profile, label, glyph) {
	return instance(
		position,
		STARTER,
		"com.amansprojects.starterpack.switchprofile",
		{ profile },
		{ image_override: toDataUri(navFace({ label, glyph })) },
	);
}

const GLYPH_PROMPT = "M40 30l24 22-24 22M76 74h30";
const GLYPH_BACK = "M98 52H48M68 30L46 52l22 22";

const defaultPath = join(profilesDir, device, "Default.json");
const defaultPage = existsSync(defaultPath) ? readJson(defaultPath) : { keys: Array(KEYS).fill(null), sliders: [], infobars: [] };
if (defaultPage.keys.length !== KEYS) {
	console.error(`page.mjs: the ready-made page is laid out for a ${KEYS}-key deck and ${device} has ${defaultPage.keys.length} keys; drag the Tern actions onto keys in OpenDeck instead`);
	process.exit(1);
}

const pagePath = join(profilesDir, device, `${PAGE}.json`);
backup(pagePath);
mkdirSync(dirname(pagePath), { recursive: true });
writeJson(pagePath, {
	keys: LAYOUT.map((entry, position) => {
		if (entry == null) return null;
		const [kind, settings] = entry;
		return kind === "back" ? switchKey(position, "Default", "Back", GLYPH_BACK) : ternKey(position, kind, settings);
	}),
	sliders: [],
	infobars: [],
});
console.log(`wrote ${pagePath}`);

const opensPage = (key) => key?.action?.uuid === "com.amansprojects.starterpack.switchprofile" && key?.settings?.profile === PAGE;
if (defaultPage.keys.some(opensPage)) {
	console.log("Default already has a key for the Tern page");
} else {
	const free = defaultPage.keys.findIndex((key) => key == null);
	if (free < 0) {
		console.log("Default has no free key: add a Switch Profile key for \"Tern\" by hand");
	} else {
		backup(defaultPath);
		defaultPage.keys[free] = switchKey(free, PAGE, "Tern", GLYPH_PROMPT);
		writeJson(defaultPath, defaultPage);
		console.log(`Default: key ${free + 1} opens the Tern page`);
	}
}

if (select) {
	const devicePath = join(profilesDir, `${device}.json`);
	backup(devicePath);
	writeJson(devicePath, { ...(existsSync(devicePath) ? readJson(devicePath) : {}), selected_profile: PAGE });
	console.log("the deck shows the Tern page at OpenDeck's next start");
}
