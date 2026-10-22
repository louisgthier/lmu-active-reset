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
  await app.evaluate(() =>
    global.sectorTest.wheelBinding(
      "WHEEL:0123456789ABCDEF0123456789ABCDEF:128",
    ),
  );
  await app.evaluate(() => global.sectorTest.show());
  await panel.getByRole("button", { name: /Change save shortcut/ }).click();
  await page
    .getByRole("button", { name: "Bind wheel button", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: "Change save shortcut, Wheel 0123 · Button 128",
      exact: true,
    })
    .waitFor();
  await panel.getByRole("button", { name: /Change restore shortcut/ }).click();
  await page
    .getByRole("button", { name: "Bind wheel button", exact: true })
    .click();
  await page
    .getByText("That wheel button is already assigned to the other action.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await panel.getByRole("button", { name: /Change save shortcut/ }).click();
  await page.keyboard.press("F6");
  await panel
    .getByRole("button", { name: "Change save shortcut, F6", exact: true })
    .waitFor();
  await app.evaluate(() =>
    global.sectorTest.window().webContents.send("sector:game", {
      running: true,
      launching: false,
      eac: false,
      safety: {
        enabled: false,
        canEnable: true,
        canRearm: true,
        restartRequired: true,
      },
    }),
  );
  await panel
    .getByRole("button", { name: "Reactivate Active Reset", exact: true })
    .waitFor();
  await panel.getByText(/Previous host stopped cleanly/).waitFor();
  assert.equal(
    await app.evaluate(() => global.sectorTest.hasListener()),
    false,
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
    "PASS packaged preview: four safety controls, denied game/reset/Steam actions, sandbox and renderer network restrictions; wheel capture, duplicate rejection and keyboard rebinding; no listener.",
  );
} finally {
  await app.close();
}
