import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("../../..");
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const work = path.join(root, "work/hardening-preview");
fs.mkdirSync(work, { recursive: true });
const env = { ...process.env, SECTOR_PREVIEW_ROOT: work };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.join(
    root,
    `releases/Sector-${version}-win-x64/Sector.exe`,
  ),
  args: ["--preview", "--smoke"],
  chromiumSandbox: true,
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Active Reset", exact: true }).click();
  const panel = page.getByRole("tabpanel", {
    name: "Active Reset",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Enable Active Reset", exact: true })
    .waitFor();
  for (const name of [
    "Start offline session without EAC",
    "Enable Active Reset",
    "Disable Active Reset",
    "Restart LMU through Steam",
  ])
    assert.equal(
      await panel.getByRole("button", { name, exact: true }).isDisabled(),
      true,
    );
  const result = await page.evaluate(async () => ({
    launch: await window.sector.launchGame(),
    enable: await window.sector.enableReset(),
    restart: await window.sector.restartOnline(),
    reset: await window.sector.reset("save"),
    browserRequire: typeof window.require,
    process: typeof window.process,
  }));
  for (const name of ["launch", "enable", "restart", "reset"])
    assert.equal(result[name].ok, false, name);
  assert.equal(result.browserRequire, "undefined");
  assert.equal(result.process, "undefined");
  const isolation = await app.evaluate(() => ({
    listener: global.sectorTest.hasListener(),
    args: process.argv,
    preferences: global.sectorTest.window().webContents.getLastWebPreferences(),
  }));
  assert.equal(isolation.listener, false);
  assert.equal(isolation.preferences.sandbox, true);
  assert.equal(isolation.preferences.contextIsolation, true);
  assert.equal(isolation.preferences.nodeIntegration, false);
  assert.equal(isolation.args.includes("--no-sandbox"), false);
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("https://example.com");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await page.screenshot({ path: path.join(work, "offline-controls.png") });
  fs.writeFileSync(
    path.join(work, "verification.json"),
    JSON.stringify(
      {
        version,
        previewIsolation: true,
        blockedActions: result,
        sandbox: true,
        noListener: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS packaged preview: four safety controls, denied game/reset/Steam actions, sandbox and renderer network restrictions; no listener.",
  );
} finally {
  await app.close();
}
