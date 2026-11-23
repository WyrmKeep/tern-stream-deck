--!nocheck

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local serde = require("@lune/serde")
local stdio = require("@lune/stdio")

local model_path = process.args[1]
local fixture_path = process.args[2]
if model_path == nil or fixture_path == nil then
	stdio.ewrite("usage: lune run luau-dump.luau <model.luau> <fixture.json | ->\n")
	process.exit(2)
end

local model = luau.load(fs.readFile(model_path), { debugName = model_path })()
local fixture = serde.decode("json", fixture_path == "-" and stdio.readToEnd() or fs.readFile(fixture_path))
local input = fixture.input or {}
local states = model.build({
	data = input.data,
	history = input.history,
	now = input.now,
	fetched_at = input.fetched_at,
	loading = input.loading,
	error = input.error,
	placed = input.placed,
})

stdio.write(serde.encode("json", states) .. "\n")
