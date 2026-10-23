<p align="center">
  <img src="assets/sector-logo-orange.png" width="112" height="112" alt="Sector logo">
</p>

<h1 align="center">Sector</h1>

<p align="center">
  <a href="https://github.com/sector-lmu/Sector"><img src="https://img.shields.io/badge/Star_this_repo-181717?style=for-the-badge&amp;logo=github&amp;logoColor=white" alt="Star this repo"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://github.com/sector-lmu/Sector/stargazers"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2Fsector-lmu%2FSector&amp;query=%24.stargazers_count&amp;style=for-the-badge&amp;label=Stars&amp;color=73B7FF" alt="GitHub stars"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://ko-fi.com/illandiii"><img src="https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&amp;logo=ko-fi&amp;logoColor=white" alt="Support Sector on Ko-fi"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-73B7FF?style=for-the-badge" alt="License: MIT"></a>
</p>

**Community offline-practice fork.** This fork adds guarded offline activation, wheel-button bindings and checkpoint best-attempt timing. Download the ready-to-install Windows build from [this fork's Releases page](https://github.com/louisgthier/lmu-active-reset/releases). Original Sector is credited in the links above.

**Practice your driving and keep useful race information in view.**

**Active Reset is experimental.** Check the
[Releases page](https://github.com/louisgthier/lmu-active-reset/releases) for downloadable
builds and their known limitations. This fork's changes are maintained on
`harden-offline-reset`; source commits may precede published downloads.

Sector is a Windows app for **Le Mans Ultimate**. Save a point on track and return
to it to practice a corner or section again. Add customizable widgets over the
game to see standings, lap times, pedal inputs and more.

<p align="center">
  <a href="https://github.com/louisgthier/lmu-active-reset/releases"><strong>Download Sector for Windows</strong></a>
  &nbsp;&nbsp;&nbsp;
  <a href="docs/README.md">User guide</a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://github.com/sector-lmu/Sector/issues">Report a problem</a>
</p>

![Sector Home with session information, reset actions and overlay layout](docs/media/home.png)

## 📥 Install Sector

You need **Windows 64-bit** and an installed copy of **Le Mans Ultimate**.

1. Open [this fork's Releases page](https://github.com/louisgthier/lmu-active-reset/releases).
2. Download **`Sector-<version>-win-x64-Setup.exe`** under Assets and open it.
3. Choose Install, then open Sector using the Start menu or desktop shortcut.

The Setup EXE includes all required application files. It installs for your Windows
account under `%LOCALAPPDATA%\Programs\Sector` without administrator rights.
Pin the installed Sector shortcut to your taskbar. Future installers update the
same path and preserve preferences; quit Sector completely before updating.

Alternatively, download `Sector-<version>-win-x64.zip`, choose Extract All, and run
`Sector.exe` inside the extracted folder. **Keep the entire folder together.**
Moving only `Sector.exe` to the desktop will not work; create a shortcut instead.

Choose the installer or portable ZIP, not GitHub's Source code downloads. No
Python, Node.js, SDK or development tools are required. Downloads are unsigned;
Windows may show an unknown-publisher prompt. See [Windows downloads](docs/WINDOWS_DOWNLOADS.md)
for updates, checksums and limitations. This build remains experimental and
cannot guarantee protection against bans or unknown malware.

## 🚦 First launch

Sector looks for your LMU installation automatically. Confirm the folder it finds,
or use the folder picker to select it yourself. The correct folder contains
`Le Mans Ultimate.exe`.

Choose **Choose folder** to open the Windows folder picker. Setup stays open
until you confirm a valid installation; Escape and clicks outside cannot skip it.

If you do not know where LMU is installed, find it in your Steam Library, open
its **Manage → Browse local files** option and use that folder in Sector.

You can then choose a short guided tour. Open it again at any time through
**Help → Guide** in Sector's top menu.

To move Sector to another LMU installation, open **Edit → Settings → Le Mans
Ultimate** and select **Change folder**. Choose the folder containing
`Le Mans Ultimate.exe`. Sector validates and remembers the selection.

The **Home** tab brings together your session, checkpoint and overlay layout.
In **Active Reset**, choose **Open LMU without EAC** to open the game from the
installation folder you confirmed. If EAC is detected, Sector shows a warning
and blocks Save/Restore and their shortcuts. Close LMU before reopening it here.
Steam must be available. The button shows when LMU is already running.

From Home, use **Save checkpoint** or **Restore checkpoint** to perform the action.
Change their keys in **Active Reset**. Use **Edit layout** and **Overlays on/off**
to manage your widgets. Open **Help → Changelog** for the changes in each update. Session figures
update from the game; unavailable values appear as `-`.

**Active Reset requires LMU's Offline mode.** Select **Offline** in the game,
then start a **Practice** session. LMU must also be launched without
**Easy Anti-Cheat (EAC)**.

Sector checks compatibility with your installed game. If an LMU update is not
supported, Active Reset will refuse to connect; check for a newer Sector release.

## 🏁 Active Reset

Active Reset lets you repeat the same part of a track without driving a full lap
back to it. A **checkpoint** is a saved point that includes your car's position,
direction and driving state at that moment.

1. Start LMU **without Easy Anti-Cheat (EAC)** and select **Offline** mode.
2. Load a **Practice** session, enter **DRIVE** and wait for Sector to connect.
3. With a healthy car, return to the game and press **F6** at your starting point.
   Wait for **Checkpoint saved** before continuing.
4. Keep driving, then press **F7** to return to that checkpoint.

The car returns with the saved driving state, including its saved speed. Saving
again replaces the checkpoint, so you can choose a new section to practice.
If Sector reports that the checkpoint is no longer available, save a new one.

Checkpoints belong to the current car and session. They are not saved practice
files that you can reload after restarting the game. Changing sessions or having
LMU rebuild your car can invalidate the checkpoint.

### Restoring after damage

Save while the car is healthy. After an impact has ended, restore that checkpoint
to recover the supported physical and bodywork state. Visible front bodywork
repair has been verified on the Mercedes-AMG LMGT3. Damage restoration is still
experimental: other cars and impact types need further testing. Puncture repair
has been verified on the Peugeot 9X8; other models still need testing.
Detached parts are not supported.

If a save or restore is refused, read the message in Sector. Repair the car or
start a fresh Practice if it cannot accept a healthy checkpoint.

Expand the **reset log** below the checkpoint card to review recent status
messages. Use **Errors & warnings** to narrow the list, or **Export diagnostics**
to save a report for support. The on-screen list covers the current app run;
the diagnostic export also includes recent saved logs.

### Change the keys and sounds

Open **Active Reset**, click the key you want to change and press its replacement
on your keyboard. Choose keys that are not already assigned to an action in LMU.
Release both keys before using them in the game.

Confirmation sounds tell you when a save or restore succeeds, or when a request
is rejected. Enable **Confirmation sounds** on the same page and use
**Save sound** or **Restore sound** to listen to a preview.

<details>
<summary>View Active Reset settings</summary>

![Sector Active Reset with save and restore shortcuts and confirmation sounds](docs/media/active-reset.png)

</details>

## 📊 Overlay

Overlays are small widgets displayed over the game. Choose the information you
want to keep in view:

Overlays use LMU's public telemetry interface independently of Active
Reset, including online sessions with EAC enabled. Launch LMU normally through
Steam and enable your widgets. Active Reset remains unavailable online. This
new connection path has passed local tests; live online verification is pending.

![The ten Sector widgets, including Tyres, Stint planner and Hybrid](docs/media/widgets.png)

*Widget previews use demo data.*

| Widget | What it shows |
| --- | --- |
| **Leaderboard** | Standings, classes, tyre compounds and available virtual energy; your nearby rivals stay in your class section |
| **Relative** | Nearby cars and estimated gaps |
| **Weather** | Available weather information |
| **Delta** | How your current lap compares with the reference lap |
| **Inputs** | Pedals, steering, gear and speed |
| **Laps** | Lap history and available usage information |
| **Session** | Session and player information |
| **Tyres** | Tyre life, tread temperatures, compound, tyre laps and flat spot estimates |
| **Stint planner** | Estimated laps remaining, pit lap and fuel/energy consumption |
| **Hybrid** | Battery charge, electric power, deploy/regen state and learned map suggestions |

### Widgets in motion

Watch the pedals, steering, gears and lap delta update in this demo.

![Animated preview of the Inputs and Delta widgets using demo data](docs/media/widgets-demo.gif)

### Make it your own

Open **Overlay**, enable the widgets you want and turn on **Overlays**.
Use **Edit layout** to move and resize them, then select **Lock layout** when
finished. Once locked, mouse clicks pass through to the game.

Each widget has its own options. You can change size and transparency, hide
columns or logos, and remove elements such as the clutch input. To choose a
monitor, open **Edit → Settings → Overlay**.

Select a widget in the list to adjust its **X**, **Y** and **Size** values.
Drag the **Opacity** slider to see transparency change immediately. In
**Inputs**, enable the steering wheel to choose a **Wheel marker** color and
adjust its rotation range. Manufacturer logos include Genesis and recognize
the GMR-001 when that name is supplied by the game.

Tyres shows all four wheels and lets you choose which readings to display and
set the temperature color ranges.
Stint planner has a consumption averaging window and a lap reserve. Its estimates
become available after Sector records complete clean laps; unknown readings show `-`.

![Sector overlay editor with the Inputs preview, section switches, position, size and appearance controls](docs/media/overlay-editor.png)

<details>
<summary>View app settings</summary>

![Sector settings with reduced motion and overlay display selection](docs/media/settings.png)

</details>

Run LMU in **windowed or borderless mode**. The live widgets appear when you are
in a session with the game in the foreground. They hide when you pause, leave
the game window or lose telemetry, and return when live data resumes. During F7,
Sector keeps the last frame visible until the restored car's data arrives.

Updates follow the refresh rate of the display selected for overlays. There is
no refresh-rate setting to adjust. Actual data updates also depend on what LMU
provides. A `~` marks estimated values, including gaps between timing updates
and flat spot detection. Stint and hybrid suggestions need observed laps before
they become available; they do not change the car's settings for you.

The editor can show sample data while you arrange your layout. Live values that
the game does not provide appear as `-`.
Online sessions may provide less information about opponents; missing readings
stay unavailable while standings and scored gaps use the data LMU supplies.

## Keep Sector running in the background

Closing the window gives you three choices:

- **Run in background** keeps Sector and its shortcuts running while hiding the window.
- **Quit Sector** closes the app and stops its features.
- **Cancel** returns to the window.

To reopen Sector, use its icon in the Windows notification area beside the clock,
or launch `Sector.exe` again.

## Update Sector

1. Close the running version with **Quit Sector**, rather than leaving it in the background.
2. Download the new `Sector-<version>-win-x64-Setup.exe` from [Releases](https://github.com/louisgthier/lmu-active-reset/releases).
3. Run it to update the existing installation. Your executable path and pinned shortcut stay the same.

For a portable installation, extract the new ZIP into a new folder and update
your shortcut to that folder's `Sector.exe` instead.

Your shortcut assignments, overlay layout and first-launch choices are retained.
Keep the files from each package together; do not copy only the new EXE over an
older installation. If Active Reset asks you to restart LMU, restart it before
making a new checkpoint.

### Sector 1.0.0

Original upstream release: [Sector 1.0.0](https://github.com/sector-lmu/Sector/releases/tag/v1.0.0).
Version 1.0.0 brings the current desktop and overlay features to `prod`.
Active Reset and damage repair remain experimental. Restart LMU after upgrading
and save a fresh checkpoint with a healthy car.

- Experimental wheel reattachment for the mapped independent-hub suspension.
  Live validation is pending; unsupported suspension layouts remain blocked.
- Separate diagnostic messages for suspension and detached-component failures.
- Immediate EAC warning and disabled reset controls when protection is detected.
- Additional diagnostics for penalty reports. The track-limit issue is still
  under investigation.
- More space for Active Reset and the overlay editor.
- Change the LMU installation folder in Settings.
- Open a GitHub bug report through **Help → Report a bug**.
- Light interface with orange accents, updated typography and clearer menus.
- Live opacity sliders and steering-wheel marker color choices.
- Genesis manufacturer logo support.
- Orange Sector logo and a more readable startup animation. The animation
  plays on a fresh app launch, not when returning from the background.

Wheel reattachment, lap timing after F7 and online overlays still need live
verification. See the [verification notes](docs/TEST_RESULTS.md) for the tested
scenarios and current limits.

Open **Help → Changelog** for the complete in-app version history. The
[release notes](https://github.com/louisgthier/lmu-active-reset/releases)
list published downloads and their current limitations.

## Need help?

See the [user guide](docs/README.md) for setup help, common problems and updating
Sector. You can also open **Help → Guide** inside the app.

For a bug report, include your Sector version, LMU version, car and track, the
exact message and the steps that reproduce it. For a display issue, include a
screenshot and your monitor setup. Report problems through
[GitHub Issues](https://github.com/sector-lmu/Sector/issues).
**Help → Report a bug** opens a new issue in your browser; you review and submit
the report yourself.

Reproduce the problem, then open **Help → Export diagnostics** and
choose **Save diagnostic file**. Send the resulting JSON file with your report.
It contains recent text logs, reset error details, app/graphics versions and
available car/track context. Windows user-directory names are masked. Nothing
is uploaded automatically. Restart LMU after upgrading to this diagnostic build.

## Support Sector

If Sector is useful to you, give the repository a star. You can also support
its development with a **[voluntary donation on Ko-fi](https://ko-fi.com/illandiii)**.

Sector is an independent project and is not affiliated with Le Mans Ultimate.
Its original code and documentation use the [MIT license](LICENSE); third-party
assets retain their [own terms and attribution](src/ui/electron/THIRD_PARTY_NOTICES.md).

Interested in contributing? See the [developer guide](CONTRIBUTING.md).
