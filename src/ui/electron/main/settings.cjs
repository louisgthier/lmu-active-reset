const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const keymap = path.join(__dirname, "../shared/reset_keymap.json");
const keys = require(
  fs.existsSync(keymap)
    ? keymap
    : "../../../python/sector/desktop/reset_keymap.json",
);
const defaults = Object.freeze({
  save_key: "F6",
  restore_key: "F7",
  sound: true,
  reduce_motion: false,
});

function validateSettings(value) {
  const find = (name) =>
    typeof name === "string" &&
    (keys.find((key) => key.name.toUpperCase() === name.toUpperCase()) ||
      (/^WHEEL:[0-9A-F]{32}:([1-9][0-9]{0,2})$/.test(name.toUpperCase()) &&
        Number(name.split(":")[2]) <= 128 && { name: name.toUpperCase() }));
  const save = find(value?.save_key);
  const restore = find(value?.restore_key);
  if (
    !save ||
    !restore ||
    save.name.toUpperCase() === restore.name.toUpperCase() ||
    (save.virtual_key !== undefined && save.virtual_key === restore.virtual_key) ||
    typeof value?.sound !== "boolean"
  ) {
    throw new Error("Choose two different keyboard keys or wheel buttons.");
  }
  if (
    value.reduce_motion !== undefined &&
    typeof value.reduce_motion !== "boolean"
  ) {
    throw new Error("Reduce motion must be enabled or disabled.");
  }
  return {
    save_key: save.name,
    restore_key: restore.name,
    sound: value.sound,
    reduce_motion: value.reduce_motion ?? false,
  };
}

function readSettings(filename) {
  try {
    return validateSettings(
      JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "")),
    );
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        "Settings could not be read. Restore defaults to repair them.",
      );
    return { ...defaults };
  }
}

function writeSettings(filename, value) {
  const settings = validateSettings(value);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings), "utf8");
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return settings;
}

module.exports = {
  defaults,
  keys,
  validateSettings,
  readSettings,
  writeSettings,
};
