import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { level as levelOf, timeUntil } from "./model.mjs";

const SIZE = 144;

export const COLORS = {
	text: "#e6e7ee",
	sub: "#9a9cab",
	dim: "#5b5e6b",
	ok: "#5fd0a0",
	warn: "#f0b25a",
	hot: "#ee8a5c",
	bad: "#e5566b",
	off: "#5b5e6b",
	signedOut: "#7a6cf0",
	accent: "#6ea8fe",
	track: "#24252b",
};

const SANS = "'Adwaita Sans', Inter, 'Noto Sans', 'DejaVu Sans', sans-serif";
const MONO = "'Adwaita Mono', 'Noto Sans Mono', 'DejaVu Sans Mono', monospace";
const SANS_EM = 0.58;
const MONO_EM = 0.6;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x) => Number(x.toFixed(2));

function svg(body) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="#000"/>${body}</svg>`;
}

export function toDataUri(svgText) {
	return "data:image/svg+xml;base64," + Buffer.from(svgText, "utf8").toString("base64");
}

function text(content, { x, y, size, family = SANS, em = SANS_EM, weight = 500, fill = COLORS.text, anchor = "middle", maxWidth = null }) {
	const estimated = [...String(content)].length * size * em;
	const squeeze = maxWidth != null && estimated > maxWidth ? ` textLength="${n(maxWidth)}" lengthAdjust="spacingAndGlyphs"` : "";
	return `<text x="${n(x)}" y="${n(y)}" font-family="${family}" font-size="${n(size)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${squeeze}>${esc(content)}</text>`;
}

export function loadIcons(dir) {
	const icons = {};
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".svg")) continue;
		const source = readFileSync(join(dir, file), "utf8");
		const open = source.match(/<svg\b([^>]*)>/);
		const close = source.lastIndexOf("</svg>");
		if (!open || close < 0) continue;
		const viewBox = open[1].match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 24 24";
		const attrs = ["fill", "fill-rule"].map((name) => open[1].match(new RegExp(`\\s${name}="[^"]+"`))?.[0] ?? "").join("");
		icons[file.slice(0, -4)] = { viewBox, attrs, inner: source.slice(open.index + open[0].length, close) };
	}
	return icons;
}

function providerIcon(icons, iconName, label, { x, y, size, opacity }) {
	const icon = icons?.[String(iconName ?? "").replace(/^provider:/, "")];
	if (icon) {
		return `<svg x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" viewBox="${icon.viewBox}"${icon.attrs} color="${COLORS.text}" opacity="${opacity}">${icon.inner}</svg>`;
	}
	const initial = ([...String(label ?? "?")][0] ?? "?").toUpperCase();
	return `<g opacity="${opacity}">${text(initial, { x: x + size / 2, y: y + size * 0.82, size: size * 0.9, weight: 700 })}</g>`;
}

function arc(cx, cy, r, width, fraction, color) {
	const circumference = 2 * Math.PI * r;
	const length = Math.max(0, Math.min(1, fraction)) * circumference;
	if (length <= 0) return "";
	if (length >= circumference - 0.5) {
		return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
	}
	const round = length > width;
	const dash = round ? length - width : length;
	const startDegrees = -90 + (round ? (width / 2 / r) * (180 / Math.PI) : 0);
	return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="${round ? "round" : "butt"}" stroke-dasharray="${n(dash)} ${n(circumference)}" transform="rotate(${n(startDegrees)} ${cx} ${cy})"/>`;
}

const flagsOf = (state) => new Set(String(state?.view?.tone ?? "").split(" ").filter(Boolean));

const labelColor = (level) => (level === "ok" ? COLORS.sub : level === "off" ? COLORS.dim : COLORS[level]);

export function ringFace(state, icons) {
	const flags = flagsOf(state);
	const cx = 72;
	const cy = 55;
	const r = 43;
	const width = 11;
	const faded = flags.has("old") || flags.has("quiet");
	let body = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLORS.track}" stroke-width="${width}"/>`;
	if (state.fill != null) body += arc(cx, cy, r, width, state.fill, COLORS[state.level] ?? COLORS.off);
	body += providerIcon(icons, state.icon, state.name, { x: cx - 21, y: cy - 21, size: 42, opacity: faded ? 0.38 : 1 });
	if (flags.has("dis")) {
		const d = r * Math.SQRT1_2;
		body += `<circle cx="${n(cx + d)}" cy="${n(cy - d)}" r="10" fill="${COLORS.signedOut}" stroke="#000" stroke-width="3"/>`;
	}
	body += text(state.view.text, { x: 72, y: 133, size: 27, family: MONO, em: MONO_EM, weight: 600, fill: labelColor(state.level), maxWidth: 136 });
	return svg(body);
}

export function windowsFace(state, mode, now) {
	const flags = flagsOf(state);
	const windows = [...state.pool].sort((a, b) => Number(b.tightest) - Number(a.tightest)).slice(0, 3);
	let body = text(state.name, { x: 10, y: 24, size: 18, weight: 650, anchor: "start", maxWidth: 76 });
	body += text(mode === "resets" ? "resets" : flags.has("old") ? "old" : "used", { x: 134, y: 24, size: 15, anchor: "end", fill: COLORS.sub });
	const pitch = windows.length > 2 ? 37 : 44;
	const first = windows.length > 2 ? 54 : windows.length === 2 ? 66 : 84;
	windows.forEach((window, index) => {
		const y = first + index * pitch;
		const level = levelOf(window.used);
		const value = mode === "resets" ? (timeUntil(window.resetsAt, now) ?? "–") : `${Math.floor(Math.max(0, Math.min(1, window.used)) * 100 + 0.5)}%`;
		const valueWidth = [...value].length * 19 * MONO_EM;
		body += text(window.name, { x: 10, y, size: 18, anchor: "start", fill: COLORS.sub, maxWidth: 124 - valueWidth - 8 });
		body += text(value, { x: 134, y, size: 19, family: MONO, em: MONO_EM, weight: 600, anchor: "end", fill: mode === "resets" ? COLORS.text : level === "ok" ? COLORS.text : COLORS[level] });
		body += `<rect x="10" y="${y + 7}" width="124" height="6" rx="3" fill="${COLORS.track}"/>`;
		const filled = 124 * Math.max(0, Math.min(1, window.used));
		if (filled >= 1) body += `<rect x="10" y="${y + 7}" width="${n(Math.max(6, filled))}" height="6" rx="3" fill="${COLORS[level]}"/>`;
	});
	return svg(body);
}

export function nameLines(name, perLine = 10) {
	const words = String(name).split(/[\s_\-./]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
	if (words.length === 0) return [""];
	const lines = [words[0]];
	for (const word of words.slice(1)) {
		const last = lines[lines.length - 1];
		if (lines.length < 2 && [...last].length + [...word].length > perLine) lines.push(word);
		else lines[lines.length - 1] = last + (/[\s_\-./]/.test(name) ? " " : "") + word;
	}
	return lines.map((line) => ([...line].length > perLine + 3 ? [...line].slice(0, perLine + 2).join("") + "…" : line));
}

function frame(active) {
	return active
		? `<rect x="4" y="4" width="136" height="136" rx="20" fill="#131a29" stroke="${COLORS.accent}" stroke-width="5"/>`
		: `<rect x="3" y="3" width="138" height="138" rx="20" fill="#0c0d11" stroke="#23252e" stroke-width="2"/>`;
}

function dots(states, y) {
	const shown = states.slice(0, 6);
	const pitch = 21;
	const start = 72 - ((shown.length - 1) * pitch) / 2;
	return shown
		.map((state, index) => {
			const cx = n(start + index * pitch);
			if (state === "working") return `<circle cx="${cx}" cy="${y}" r="8" fill="${COLORS.accent}"/>`;
			if (state === "done") return `<circle cx="${cx}" cy="${y}" r="8" fill="${COLORS.ok}"/>`;
			return `<circle cx="${cx}" cy="${y}" r="6.5" fill="none" stroke="#565a68" stroke-width="3"/>`;
		})
		.join("");
}

export function sessionFace({ name, shown, agents, tabs }) {
	const nameEm = 0.62;
	const nameWidth = 118;
	const lines = nameLines(name);
	const longest = Math.max(...lines.map((line) => [...line].length), 1);
	const size = Math.max(17, Math.min(26, nameWidth / (longest * nameEm)));
	const fill = shown ? COLORS.text : "#c3c5d0";
	let body = frame(shown);
	const baseline = lines.length === 1 ? 62 : 46;
	lines.forEach((line, index) => {
		body += text(line, { x: 72, y: baseline + index * (size + 6), size, em: nameEm, weight: 650, fill, maxWidth: nameWidth });
	});
	const order = { working: 0, done: 1, idle: 2 };
	const ordered = agents.length > 6 ? [...agents].sort((a, b) => order[a] - order[b]) : agents;
	if (ordered.length > 0) body += dots(ordered, 114);
	else body += text(`${tabs} tab${tabs === 1 ? "" : "s"}`, { x: 72, y: 120, size: 17, fill: COLORS.dim });
	return svg(body);
}

export function emptyFace(line) {
	return svg(frame(false) + text(line, { x: 72, y: 80, size: 19, fill: COLORS.dim, maxWidth: 124 }));
}

export function agentsFace({ working, done, total }) {
	let body = frame(false);
	body += text("agents", { x: 72, y: 30, size: 17, fill: COLORS.sub });
	body += text(String(working), { x: 72, y: 92, size: 62, family: MONO, em: MONO_EM, weight: 700, fill: working > 0 ? COLORS.accent : COLORS.dim });
	if (done > 0) body += text(`${done} done`, { x: 72, y: 126, size: 21, weight: 650, fill: COLORS.ok });
	else body += text(working > 0 ? "working" : `${total} idle`, { x: 72, y: 126, size: 19, fill: COLORS.dim });
	return svg(body);
}

export function newTabFace({ label, accent }) {
	const color = accent ? COLORS.accent : COLORS.sub;
	let body = frame(false);
	body += `<rect x="40" y="20" width="64" height="64" rx="16" fill="none" stroke="${color}" stroke-width="5"/>`;
	body += `<path d="M72 36v32M56 52h32" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`;
	body += text(label, { x: 72, y: 122, size: 23, weight: 650, fill: COLORS.text, maxWidth: 124 });
	return svg(body);
}

export function navFace({ label, glyph }) {
	let body = frame(false);
	body += `<path d="${glyph}" fill="none" stroke="${COLORS.sub}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
	body += text(label, { x: 72, y: 122, size: 23, weight: 650, fill: COLORS.text, maxWidth: 124 });
	return svg(body);
}
