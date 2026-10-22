const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function verifyRuntime(root, resources) {
  const bytes = fs.readFileSync(
    path.join(resources, "runtime/release-manifest.json"),
  );
  if (
    sha(bytes).slice(0, 16) !==
    fs.readFileSync(path.join(resources, "release-id"), "utf8").trim()
  )
    throw new Error("Bundled runtime manifest identity mismatch.");
  if (fs.lstatSync(root).isSymbolicLink())
    throw new Error("Runtime root must not be a link.");
  if (!fs.readFileSync(path.join(root, "release-manifest.json")).equals(bytes))
    throw new Error("Copied runtime manifest changed.");
  const manifest = JSON.parse(bytes);
  for (const [relative, hash] of Object.entries(manifest)) {
    const parts = relative.split("/");
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative.includes("\\") ||
      relative.includes(":") ||
      parts.some((part) => !part || part === "." || part === "..") ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw new Error("Invalid runtime inventory entry.");
    let file = root;
    for (const part of parts) {
      file = path.join(file, part);
      if (fs.lstatSync(file).isSymbolicLink())
        throw new Error("Linked runtime entry refused.");
    }
    if (!fs.statSync(file).isFile() || sha(fs.readFileSync(file)) !== hash)
      throw new Error(
        `Runtime integrity mismatch: ${relative}. Re-extract the trusted package.`,
      );
  }
  function extras(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Linked runtime entry refused.");
      if (
        !prefix &&
        ["work", "logs"].includes(entry.name) &&
        entry.isDirectory()
      )
        continue;
      if (entry.isDirectory()) {
        extras(file, relative + "/");
        continue;
      }
      if (
        relative === "release-manifest.json" ||
        Object.hasOwn(manifest, relative)
      )
        continue;
      // The runner creates unique copies of the exact verified host for loading.
      if (
        /^bin\/lmu-physical-reset-v28-25661166-[a-f0-9]{32}\.dll$/.test(
          relative,
        ) &&
        sha(fs.readFileSync(file)) ===
          manifest["bin/lmu-physical-reset-v28-25661166.dll"]
      )
        continue;
      throw new Error(`Unlisted runtime file refused: ${relative}`);
    }
  }
  extras(root);
}
module.exports = { verifyRuntime };
