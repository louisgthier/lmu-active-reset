import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { rcedit } from "rcedit";
import { pruneOldBuilds } from "./release-retention.mjs";

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(ui, "../../..");
const { version, license } = JSON.parse(
  fs.readFileSync(path.join(ui, "package.json")),
);
// Local prereleases must use verified source-built Sector native components.
const nativeBuild = JSON.parse(
  fs.readFileSync(path.join(root, "work/native-build-provenance.json"), "utf8"),
);
const digest = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (
  nativeBuild.schema !== 1 ||
  nativeBuild.native_origin !==
    "compiled from Sector source locally; no upstream Sector executable copied"
)
  throw new Error(
    "Source-built native provenance required. Run Build-OfflineNative.ps1 first.",
  );
for (const name of [
  "diagnostic-14200.exe",
  "overlay-reader.exe",
  "lmu-physical-reset-v28-25661166.dll",
])
  if (digest(path.join(root, "bin", name)) !== nativeBuild.binaries[name])
    throw new Error(`Stale native build: ${name}`);
for (const [relative, expected] of Object.entries(nativeBuild.native_sources)) {
  if (
    !relative.startsWith("src/native/") &&
    !relative.startsWith("third_party/minhook/")
  )
    throw new Error("Invalid native source inventory.");
  if (
    relative.split("/").includes("..") ||
    digest(path.join(root, relative)) !== expected
  )
    throw new Error(`Native source changed after build: ${relative}`);
}
const output = path.join(root, "releases", `Sector-${version}-win-x64`);
if (fs.existsSync(output))
  throw new Error(
    `Output already exists: ${output}. Move it before rebuilding.`,
  );
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (p) => !p.includes("__pycache__"),
  });
};
copy(path.join(ui, "node_modules/electron/dist"), output);
copy(path.join(root, "LICENSE"), path.join(output, "LICENSE-Sector.txt"));
fs.renameSync(
  path.join(output, "electron.exe"),
  path.join(output, "Sector.exe"),
);
fs.rmSync(path.join(output, "resources/default_app.asar"), { force: true });
const app = path.join(output, "resources/app");
for (const name of ["main", "shared", "dist", "THIRD_PARTY_NOTICES.md"])
  copy(path.join(ui, name), path.join(app, name));
fs.writeFileSync(
  path.join(app, "package.json"),
  JSON.stringify({
    name: "sector",
    productName: "Sector",
    version,
    license,
    main: "main/index.cjs",
  }),
);
copy(
  path.join(root, "src/python/sector/desktop/reset_keymap.json"),
  path.join(app, "shared/reset_keymap.json"),
);
copy(path.join(ui, "licenses"), path.join(app, "licenses"));
copy(
  path.join(ui, "renderer/overlays/fonts/LICENSE.txt"),
  path.join(app, "licenses/overlay-fonts.txt"),
);
copy(
  path.join(root, "third_party/minhook/LICENSE.txt"),
  path.join(app, "licenses/minhook.txt"),
);
function copyLicenses(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) copyLicenses(file);
    else if (/^(license|copying|notice)(\.|$)/i.test(entry.name))
      copy(
        file,
        path.join(
          app,
          "licenses/npm",
          path.relative(path.join(ui, "node_modules"), file),
        ),
      );
  }
}
copyLicenses(path.join(ui, "node_modules"));
const runtime = path.join(output, "resources/runtime");
for (const name of ["src/python", "assets/sector.ico", "scripts/sector.py"])
  copy(path.join(root, name), path.join(runtime, name));
for (const name of [
  "diagnostic-14200.exe",
  "overlay-reader.exe",
  "lmu-physical-reset-v28-25661166.dll",
])
  copy(path.join(root, "bin", name), path.join(runtime, "bin", name));
fs.mkdirSync(path.join(runtime, "compatibility"), { recursive: true });
for (const name of fs
  .readdirSync(path.join(root, "compatibility"))
  .filter((n) => /^steam-25661166-.*\.json$/.test(n))) {
  const profile = JSON.parse(
    fs
      .readFileSync(path.join(root, "compatibility", name), "utf8")
      .replace(/^\uFEFF/, ""),
  );
  delete profile.install_path;
  delete profile.previous_dll_path;
  fs.writeFileSync(
    path.join(runtime, "compatibility", name),
    JSON.stringify(profile),
  );
}
// Verify the shipped host and reader against the same profiles used at runtime.
const sha = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const telemetry = JSON.parse(
  fs.readFileSync(
    path.join(runtime, "compatibility/steam-25661166-telemetry.json"),
  ),
);
const host = JSON.parse(
  fs.readFileSync(
    path.join(runtime, "compatibility/steam-25661166-physical-reset-v28.json"),
  ),
);
if (
  sha(path.join(runtime, "bin/diagnostic-14200.exe")) !==
    telemetry.diagnostic_sha256.toLowerCase() ||
  sha(path.join(runtime, "bin/lmu-physical-reset-v28-25661166.dll")) !==
    host.dll_sha256.toLowerCase()
)
  throw new Error("Runtime binary/profile mismatch");
const pythonArchive = path.join(
  root,
  "work/release-tools/python-3.13.12-embed-amd64.zip",
);
if (!fs.existsSync(pythonArchive))
  throw new Error(
    `Download the official Python embedded archive to ${pythonArchive}`,
  );
if (
  sha(pythonArchive) !==
  "76f238f606250c87c6beac75dccd35ee99070a13490555936abb6cb64ecce3d0"
)
  throw new Error("Embedded Python archive checksum mismatch");
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `$env:PSModulePath = (Join-Path $PSHOME 'Modules'); Expand-Archive -LiteralPath '${pythonArchive.replaceAll("'", "''")}' -DestinationPath '${path.join(runtime, "python").replaceAll("'", "''")}'`,
  ],
  { stdio: "inherit" },
);
await rcedit(path.join(output, "Sector.exe"), {
  icon: path.join(root, "assets/sector.ico"),
  "file-version": version.split("-")[0],
  "product-version": version.split("-")[0],
  "version-string": {
    ProductName: "Sector",
    FileDescription: "Sector",
    CompanyName: "Sector",
    OriginalFilename: "Sector.exe",
  },
  "requested-execution-level": "asInvoker",
});
const manifest = {};
function inventory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) inventory(file);
    else
      manifest[path.relative(runtime, file).replaceAll("\\", "/")] = sha(file);
  }
}
inventory(runtime);
fs.writeFileSync(
  path.join(runtime, "release-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
fs.writeFileSync(
  path.join(output, "resources/release-id"),
  sha(path.join(runtime, "release-manifest.json")).slice(0, 16),
);
fs.writeFileSync(
  path.join(output, "README.txt"),
  [
    `Sector ${version}`,
    "Active Reset and damage repair are experimental: bugs are expected and further fixes are planned.",
    "Includes an experimental wheel reattachment implementation. In-game validation is pending.",
    "",
    "LOCAL EXPERIMENTAL BUILD - NOT CERTIFIED SAFE",
    "Sector native host/readers rebuilt locally from source with official Zig 0.16.0 and verified LMU SDK headers.",
    "No guarantee against bans, unknown malware, or persistent session effects. No live-game validation performed.",
    "Active Reset starts disabled. Launch a fresh offline session here, enter Offline Practice, then explicitly enable it.",
    "Disable Active Reset stops new commands but does not unload the DLL. Close LMU before online play.",
    "Restart LMU through Steam requires confirmed process exit. Saved game data is not rolled back.",
    "",
    "UPSTREAM REFERENCE (some controls differ in this local build)",
    "1. Extract the entire ZIP and open Sector.exe. Keep all files together.",
    "2. Confirm your Le Mans Ultimate folder during first-launch setup.",
    "3. Start a fresh offline session here, choose Offline Practice and DRIVE, then click Enable Active Reset.",
    "4. With a healthy car, press F6 and wait for Checkpoint saved. Press F7 to return.",
    "5. Enable widgets in Overlay. Use Edit layout to arrange them, then Lock layout.",
    "",
    "Overlays require windowed or borderless mode and follow the selected display refresh rate.",
    "For online overlays, launch LMU normally with EAC. Active Reset stays offline-only.",
    "If EAC is detected, Sector blocks Save/Restore and their shortcuts. Close LMU and reopen it from Active Reset.",
    "Change keys and sounds in Active Reset. Open settings through Edit > Settings.",
    "Help > Guide reopens the tutorial. Help > Changelog lists version changes.",
    "After a problem, use Help > Export diagnostics > Save diagnostic file and share the JSON file.",
    "Restart LMU after upgrading so the new v28 reset module can load. Save a fresh checkpoint with a healthy car.",
    "Closing the window offers background mode or Quit Sector. Quit fully before updating.",
    "No Node.js or Python installation is required. Preferences are retained between updates.",
    "",
    "Damage repair is experimental. Wheel reattachment supports the mapped independent-hub suspension only.",
    "Other detached parts and suspension layouts remain unsupported. Track-limit penalties after reset are still under investigation.",
    "Save a healthy car and wait until an impact ends before restoring.",
    "Checkpoint availability depends on the current car, session and supported LMU version.",
    "",
    "User guide: https://github.com/sector-lmu/Sector/blob/prod/docs/README.md",
    "Downloads: https://github.com/sector-lmu/Sector/releases",
    "Report a problem: https://github.com/sector-lmu/Sector/issues",
    "",
  ].join("\r\n"),
);
fs.writeFileSync(
  path.join(output, "NATIVE-BUILD-PROVENANCE.json"),
  JSON.stringify(nativeBuild, null, 2),
);
console.log(output);
console.log("Local build: existing releases preserved.");
