const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestGameClose(game) {
  if (
    !Number.isSafeInteger(game.pid) ||
    game.pid <= 0 ||
    !/^\d+:\d+$/.test(game.identity) ||
    !game.identity.startsWith(`${game.pid}:`)
  )
    throw new Error("Cannot verify which LMU process to close.");
  // Only validated decimal PID/start-time fields enter this fixed script.
  const code =
    `$ErrorActionPreference='Stop'; $game=Get-Process -Id ${game.pid}; ` +
    `if ($game.ProcessName -ne 'Le Mans Ultimate' -or ([string]$game.Id + ':' + $game.StartTime.ToUniversalTime().Ticks) -ne '${game.identity}') { throw 'LMU identity changed' }; ` +
    `if (-not $game.CloseMainWindow()) { throw 'Close LMU manually to continue' }`;
  await execute(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(code, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 5000 },
  );
}

async function waitForGameExit({
  discover,
  close = requestGameClose,
  game,
  sleep = wait,
  attempts = 120,
}) {
  const current = await discover();
  if (current.length) {
    if (!game || current.length !== 1 || current[0].identity !== game.identity)
      throw new Error(
        "Close every LMU instance manually. No unverified process will be closed.",
      );
    await close(game);
  }
  for (let i = 0; i < attempts; i++) {
    if ((await discover()).length === 0) return;
    await sleep(250);
  }
  throw new Error(
    "LMU is still running. Restart remains blocked; close the game manually.",
  );
}
module.exports = { requestGameClose, waitForGameExit };
