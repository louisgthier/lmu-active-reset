const dash = "-";
const { WheelHistory, tyreValues } = require("./wheel-model.cjs");
const { VehicleIdentity } = require("./vehicle-identity.cjs");
const { stintValues } = require("./stint-model.cjs");
const { resourceValues } = require("./compound-model.cjs");
const { HybridHistory, hybridValues } = require("./hybrid-model.cjs");
const { relativeDistance, leaderboardGap } = require("./live-gaps.cjs");
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, min = 0, max = 1) =>
  finite(v) ? Math.max(min, Math.min(max, v)) : min;
const time = (v) =>
  finite(v) && v > 0
    ? `${Math.floor(v / 60)}:${(v % 60).toFixed(3).padStart(6, "0")}`
    : dash;
const signed = (v) =>
  finite(v) ? `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}` : dash;
const clock = (v) =>
  finite(v) && v >= 0
    ? `${Math.floor(v / 3600)}:${String(Math.floor(v / 60) % 60).padStart(2, "0")}:${String(Math.floor(v) % 60).padStart(2, "0")}`
    : dash;
const classCode = (name) =>
  /hyper|lmh|lmdh/i.test(name)
    ? "HY"
    : /(?:lm\s*)?p\s*2/i.test(name)
      ? "P2"
      : /(?:lm\s*)?p\s*3/i.test(name)
        ? "P3"
        : /gt\s*3/i.test(name)
          ? "GT3"
          : String(name || dash).slice(0, 8);
const colors = { HY: "#E5322F", P2: "#2D9CDB", P3: "#F28C28", GT3: "#1FA34A" };
const manufacturers = [
  ["GEN", "genesis|\\bgmr[ -]?001\\b"],
  ["BMW", "bmw"],
  ["MER", "mercedes|amg"],
  ["FOR", "ford|mustang"],
  ["COR", "chevrolet|corvette"],
  ["FER", "ferrari|\\b296\\b|\\b488\\b"],
  ["LAM", "lamborghini"],
  ["MCL", "mclaren|720s"],
  ["POR", "porsche|\\b911\\b|\\b992\\b"],
  ["AST", "aston|vantage"],
  ["TOY", "toyota"],
  ["CAD", "cadillac"],
  ["LEX", "lexus"],
  ["ALP", "alpine"],
  ["PEU", "peugeot"],
  ["ORE", "oreca|\\b07\\b"],
  ["IF", "isotta"],
  ["LIG", "ligier|js[ -]?p3(?:20|25)"],
  ["DUQ", "duqueine|d0[89]"],
];
const make = (vehicle) =>
  manufacturers.find(([, pattern]) =>
    new RegExp(pattern, "i").test(String(vehicle || "").replaceAll("_", " ")),
  )?.[0] || "";
function row(v, accent) {
  const manufacturer = make(v.model) || make(v.vehicleFile) || make(v.vehicle),
    player = v.player;
  return {
    car: true,
    sep: false,
    id: v.id,
    pos: v.classPlace,
    num: String(v.vehicle || "").match(/#(\d+)/)?.[1] || dash,
    make: manufacturer,
    makeName: manufacturer,
    name: v.name || dash,
    last: time(v.last),
    lastFg: "#F2F4F6",
    gapFg: "#F2F4F6",
    pit: v.pit,
    hasImg: !!manufacturer,
    noImg: !manufacturer,
    bg: player ? `${accent}38` : "transparent",
    posBg: player ? accent : "rgba(0,0,0,0.55)",
    posFg: player ? "#16181C" : "#F2F4F6",
    nameFg: player ? accent : "#F2F4F6",
    delay: "0ms",
  };
}
class TelemetryModel {
  constructor() {
    this.reset();
  }
  reset() {
    this.identities = new VehicleIdentity();
    this.wheels = new WheelHistory();
    this.hybrid = new HybridHistory();
    this.history = [];
    this.laps = [];
    this.previous = null;
    this.start = null;
    this.invalid = false;
    this.pitLap = null;
    this.lastPit = null;
    this.pendingLap = null;
    this.scoreLap = null;
  }
  update(raw) {
    if (!raw?.connected || !raw.player) {
      this.reset();
      return raw;
    }
    const old = this.previous,
      p = raw.player,
      car = raw.cars.find((c) => c.id === p.id);
    if (
      old &&
      (old.track !== raw.track ||
        old.session !== raw.session ||
        old.player.id !== p.id ||
        p.et < old.player.et ||
        p.lap < old.player.lap ||
        p.lap > old.player.lap + 1 ||
        p.lapStart < old.player.lapStart ||
        (car &&
          old.cars.find((c) => c.id === p.id) &&
          Math.abs(
            car.distance - old.cars.find((c) => c.id === p.id).distance,
          ) > 200 &&
          p.lap === old.player.lap))
    )
      this.reset();
    raw = this.identities.update(raw);
    if (!this.previous) {
      this.scoreLap = car?.laps ?? 0;
      this.start =
        p.et - p.lapStart < 0.5
          ? { fuel: p.fuel, energy: p.energy, lap: p.lap }
          : null;
    } else if (p.lap === this.previous.player.lap + 1) {
      const complete = this.start?.lap === p.lap - 1;
      // Capture consumption at the telemetry boundary, then wait for scoring.
      // The slower scoring stream can still contain the previous lap's time.
      this.pendingLap = {
        lap: this.scoreLap + 1,
        fuel:
          complete &&
          finite(this.start.fuel) &&
          finite(p.fuel) &&
          this.start.fuel >= p.fuel
            ? this.start.fuel - p.fuel
            : null,
        energy:
          complete &&
          finite(this.start.energy) &&
          finite(p.energy) &&
          this.start.energy >= p.energy
            ? (this.start.energy - p.energy) * 100
            : null,
        clean: complete && !this.invalid && !this.pitLap,
        tag: this.pitLap
          ? "PIT"
          : !complete
            ? "PART"
            : this.invalid
              ? "INV"
              : "",
      };
      this.start = { fuel: p.fuel, energy: p.energy, lap: p.lap };
      this.invalid = false;
      this.pitLap = null;
    }
    if (this.pendingLap && car?.laps >= this.pendingLap.lap) {
      if (car.laps === this.pendingLap.lap && car.last > 0) {
        this.laps.unshift({
          ...this.pendingLap,
          time: car.last,
          clean: this.pendingLap.clean && car.countLap === 2,
        });
        this.laps = this.laps.slice(0, 120);
      }
      this.scoreLap = car.laps;
      this.pendingLap = null;
    }
    this.invalid ||= Boolean(p.invalid);
    if (car?.pit) this.pitLap = true;
    if (!this.previous || p.et !== this.previous.player.et) {
      this.history.push({
        th: clamp(p.throttle),
        br: clamp(p.brake),
        cl: clamp(p.clutch),
      });
      if (this.history.length > 150) this.history.shift();
    }
    if (
      old &&
      this.previous &&
      car?.pitStops >
        (old.cars.find((c) => c.id === p.id)?.pitStops ?? car.pitStops)
    )
      this.lastPit = p.lap;
    this.previous = raw;
    return {
      ...raw,
      ...this.wheels.update(raw),
      hybridLaps: this.hybrid.update(raw),
      history: this.history,
      laps: this.laps,
      lastPit: this.lastPit,
    };
  }
}
function valuesFor(id, data, settings) {
  if (id === "tyres") return tyreValues(data, settings);
  if (id === "stint-planner") return stintValues(data, settings);
  if (id === "hybrid") return hybridValues(data, settings);
  const live = Boolean(data?.connected),
    p = live ? data.player : null,
    accent = settings.accent;
  const cars = (live ? data.cars || [] : [])
    .map((v) => ({
      ...v,
      model: v.model || (v.id === p?.id ? p.model : ""),
      cls: classCode(v.class),
    }))
    .sort((a, b) => a.place - b.place);
  const groups = {};
  for (const v of cars) {
    (groups[v.cls] ||= []).push(v);
    v.classPlace = groups[v.cls].length;
  }
  const car = cars.find((v) => (p ? v.id === p.id : v.player)),
    own = car ? groups[car.cls] : [];
  const grid = own.every((v) => v.qualification > 0)
    ? [...own].sort((a, b) => a.qualification - b.qualification)
    : [];
  const started =
    grid.length && car ? grid.findIndex((v) => v.id === car.id) + 1 : null;
  const best = car?.best > 0 ? car.best : null,
    classBest = own
      .map((v) => v.best)
      .filter((v) => v > 0)
      .sort((a, b) => a - b)[0];
  const laps = live ? data.laps || [] : [],
    clean = laps.filter((l) => l.clean),
    avg = clean.length
      ? clean.reduce((a, l) => a + l.time, 0) / clean.length
      : null;
  const avgFuel = clean.filter((l) => finite(l.fuel));
  const fuelAvg = avgFuel.length
    ? avgFuel.reduce((a, l) => a + l.fuel, 0) / avgFuel.length
    : null;
  const pb = laps.filter((l) => l.clean).sort((a, b) => a.time - b.time)[0];
  const bestRecord = pb && best && Math.abs(pb.time - best) < 0.002 ? pb : null;
  const bestLapLabel = bestRecord ? `L${bestRecord.lap}` : dash;
  const sessionName = !live
    ? dash
    : data.session >= 10
      ? "RACE"
      : data.session >= 5 && data.session <= 8
        ? "QUALIFYING"
        : data.session === 9
          ? "WARMUP"
          : "PRACTICE";
  const remaining = clock(data?.remaining),
    elapsed = clock(data?.et);
  const common = {
    best: time(best),
    remaining,
    elapsed,
    lap: p?.lap ?? dash,
    sessionName,
    trackCars: live ? `${data.track}, ${cars.length} cars` : dash,
    energy:
      finite(p?.energy) && p.energy >= 0 && p.energy <= 1
        ? `${(p.energy * 100).toFixed(1)}%`
        : dash,
    fuel: finite(p?.fuel) ? `${p.fuel.toFixed(1)} L` : dash,
    bestLapLabel,
    bestEnergy: finite(bestRecord?.energy)
      ? `${bestRecord.energy.toFixed(1)}%`
      : dash,
    bestFuel: finite(bestRecord?.fuel)
      ? `${bestRecord.fuel.toFixed(2)} L`
      : dash,
    bestGap: best && classBest ? signed(best - classBest) : dash,
    average: time(avg),
    averageEnergy:
      clean.length && clean.every((l) => finite(l.energy))
        ? `${(clean.reduce((sum, l) => sum + l.energy, 0) / clean.length).toFixed(1)}%`
        : dash,
    averageFuel: finite(fuelAvg) ? `${fuelAvg.toFixed(2)} L` : dash,
    averageGap: avg && best ? signed(avg - best) : dash,
  };
  if (id === "inputs") {
    const history = live ? data.history || [] : [];
    const pts = (k) =>
      history
        .map(
          (s, i) =>
            `${((i * 214) / 149).toFixed(1)},${(123 - clamp(s[k]) * 120).toFixed(1)}`,
        )
        .join(" ");
    const pedals = [
      { key: "clutch", color: "#4C8DFF" },
      { key: "brake", color: "#FF4D4D" },
      { key: "throttle", color: "#3DDC84" },
    ]
      .filter(
        (v) =>
          (settings.showClutch || v.key !== "clutch") &&
          settings.columns?.[v.key] !== false,
      )
      .map((v) => ({
        ...v,
        v: clamp(p?.[v.key]),
        pct: p ? Math.round(clamp(p[v.key]) * 100) : dash,
      }));
    return {
      ...common,
      pedals,
      throttlePts: settings.columns?.throttle === false ? "" : pts("th"),
      brakePts: settings.columns?.brake === false ? "" : pts("br"),
      clutchPts: settings.showClutch ? pts("cl") : "",
      speed: finite(p?.speed) ? Math.round(p.speed) : dash,
      gear: !p ? dash : p.gear === 0 ? "N" : p.gear === -1 ? "R" : p.gear,
      angle: clamp(p?.steering, -1, 1) * settings.lockDeg,
    };
  }
  if (id === "leaderboard") {
    // Preserve the design's 14-row budget; prioritize nearby cars in the player's class.
    let budget = 14;
    const entries = Object.entries(groups).sort(
      ([a], [b]) =>
        ["HY", "P2", "P3", "GT3"].indexOf(a) -
        ["HY", "P2", "P3", "GT3"].indexOf(b),
    );
    const classes = entries.map(([badge, list], i) => {
      const otherRows = entries
        .filter(([key]) => key !== badge)
        .reduce((sum, [, items]) => sum + Math.min(3, items.length), 0);
      const preferred = list.some((v) => v.player)
        ? Math.min(settings.rows, 14 - otherRows)
        : Math.min(3, settings.rows);
      const capacity = Math.max(
        1,
        Math.min(preferred, budget - (entries.length - i - 1)),
      );
      // Keep the player's neighbours inside their own class section.
      const center = list.findIndex((v) => v.player);
      let selected = list.slice(0, capacity);
      if (center >= capacity) {
        const leaders = Math.min(3, Math.max(0, capacity - 3));
        const count = capacity - leaders;
        const from = Math.max(
          leaders,
          Math.min(center - Math.floor(count / 2), list.length - count),
        );
        selected = [
          ...list.slice(0, leaders),
          ...list.slice(from, from + count),
        ];
      }
      budget -= selected.length;
      return {
        badge,
        color: colors[badge] || "#677383",
        count: list.length,
        best: time(
          Math.min(...list.map((v) => (v.best > 0 ? v.best : Infinity))),
        ),
        delay: "0ms",
        rows: selected.flatMap((v, j) => [
          ...(j > 0 && v.classPlace > selected[j - 1].classPlace + 1
            ? [{ sep: true, car: false }]
            : []),
          {
            ...row(v, accent),
            ...resourceValues(v.resources),
            gap:
              v.classPlace === 1
                ? `Lap ${v.laps}`
                : v.lapsBehind !== list[0].lapsBehind
                  ? `${v.lapsBehind - list[0].lapsBehind}L`
                  : (() => {
                      const gap = leaderboardGap(v, list[0], data.et);
                      return `${gap.estimated ? "~" : ""}${signed(gap.value)}`;
                    })(),
          },
        ]),
      };
    });
    return { ...common, classes };
  }
  if (id === "relative") {
    const rows =
      car && finite(car.distance) && data.length > 0
        ? cars
            .filter((v) => finite(v.distance))
            .map((v) => {
              const distance = relativeDistance(v, car, data.et, data.length);
              const lap = v.laps - car.laps;
              const gap =
                (-distance / data.length) *
                (car.estimated > 0 ? car.estimated : best || 0);
              return {
                ...row(v, accent),
                distance,
                cls: v.cls,
                clsColor: colors[v.cls] || "#677383",
                pos: `P${v.classPlace}`,
                hasLap: lap !== 0,
                lap: `${lap > 0 ? "+" : "\u2212"}${Math.abs(lap)} LAP`,
                lapBg: lap > 0 ? "#E2483D" : "#2F7BEA",
                gapTxt: v.player
                  ? "0.000"
                  : finite(distance) && (car.estimated > 0 || best)
                    ? `~${signed(gap)}`
                    : dash,
                gapFg: v.player
                  ? accent
                  : lap > 0
                    ? "#FF8A80"
                    : lap < 0
                      ? "#7FB8FF"
                      : "#F2F4F6",
              };
            })
            .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))
            .slice(0, settings.rows)
            .sort((a, b) => b.distance - a.distance)
        : [];
    return { ...common, rows };
  }
  if (id === "delta") {
    const checkpoint =
      live && data.checkpointTiming?.active ? data.checkpointTiming : null;
    const delta = checkpoint
      ? checkpoint.valid
        ? checkpoint.delta
        : null
      : finite(p?.delta) && best
        ? p.delta
        : null;
    const practiceClock =
      checkpoint?.valid && finite(checkpoint.seconds)
        ? `${Math.floor(checkpoint.seconds / 60)}:${(checkpoint.seconds % 60).toFixed(3).padStart(6, "0")}`
        : dash;
    return {
      ...common,
      timingTitle: checkpoint?.finished
        ? checkpoint.record
          ? "FINISHED - NEW BEST"
          : "FINISHED"
        : checkpoint
          ? "CHECKPOINT"
          : "DELTA",
      timingFg: checkpoint?.finished
        ? checkpoint.record
          ? "#C084FC"
          : "#FFAB57"
        : "#F2F4F6",
      attemptStatus: !checkpoint
        ? ""
        : checkpoint.finished
          ? "Result frozen - reset when ready"
          : checkpoint.finishDistance === null
            ? "First reset sets the finish"
            : Number.isFinite(checkpoint.remainingDistance)
              ? `${Math.ceil(checkpoint.remainingDistance)} m to finish`
              : "Waiting for telemetry",
      referenceLabel: checkpoint
        ? checkpoint.reference
          ? "vs checkpoint best"
          : "Recording reference"
        : `vs PB ${time(best)}`,
      clockLabel: checkpoint ? "time" : "pred.",
      deltaTxt: signed(delta),
      deltaFg:
        checkpoint?.finished && checkpoint.record
          ? "#C084FC"
          : delta === null
            ? "#F2F4F6"
            : delta < 0
              ? "#3DDC84"
              : "#FF5D5D",
      pred: checkpoint
        ? practiceClock
        : delta !== null
          ? time(best + delta)
          : dash,
      fastScale: delta < 0 ? clamp(-delta) : 0,
      slowScale: delta > 0 ? clamp(delta) : 0,
    };
  }
  if (id === "weather") {
    const slots = ["NOW", "+30M", "+1H", "+1H30", "+2H"].map((label, i) => ({
      label,
      temp: live && i === 0 ? `${Math.round(data.air)}\u00b0` : dash,
      rain: live && i === 0 ? `${Math.round(clamp(data.rain) * 100)}%` : dash,
      isRain: live && i === 0 && data.rain > 0.01,
      isCloud: live && i === 0 && data.rain <= 0.01 && data.cloud > 0.6,
      isPartly:
        live &&
        i === 0 &&
        data.rain <= 0.01 &&
        data.cloud > 0.2 &&
        data.cloud <= 0.6,
      isSun: live && i === 0 && data.rain <= 0.01 && data.cloud <= 0.2,
      rainScale: live && i === 0 ? clamp(data.rain) : 0,
      rainFg: "#8FBBFF",
      bg: i === 0 ? "rgba(0,0,0,.35)" : "transparent",
      labelFg: "#B8C0C8",
      delay: "0ms",
    }));
    return {
      ...common,
      slots,
      surface: live ? (data.wetness > 0.01 ? "Wet track" : "Dry track") : dash,
      air: live ? `${Math.round(data.air)}\u00b0` : dash,
      trackTemp: live ? `${Math.round(data.trackTemp)}\u00b0` : dash,
      humidity: dash,
      forecast: dash,
      rainLap: "",
    };
  }
  if (id === "laps")
    return {
      ...common,
      laps: laps.slice(0, Math.min(8, settings.rows)).map((l, i) => ({
        lap: l.lap,
        time: time(l.time),
        ve: finite(l.energy) ? `${l.energy.toFixed(1)}%` : dash,
        fuel: finite(l.fuel) ? `${l.fuel.toFixed(2)} L` : dash,
        dpb: best ? signed(l.time - best) : dash,
        dbest: classBest ? signed(l.time - classBest) : dash,
        dpbFg: l.clean ? "#F2F4F6" : "#B8C0C8",
        timeFg: l.clean ? "#F2F4F6" : "#B8C0C8",
        tag: l.tag,
        hasTag: !!l.tag,
        bg: i === 0 ? "rgba(0,0,0,.35)" : "transparent",
        delay: "0ms",
      })),
    };
  const times = laps.slice(0, 48).reverse();
  const min = Math.min(...times.map((l) => l.time)),
    max = Math.max(...times.map((l) => l.time));
  return {
    ...common,
    sessionTrack: live ? `${sessionName}, ${data.track}` : dash,
    classBadge: car?.cls || "",
    classColor: colors[car?.cls] || "#677383",
    progress: clamp(data?.et / (data?.et + data?.remaining)),
    position: car ? `P${car.classPlace}` : dash,
    classCount: own.length || dash,
    gained: started
      ? `${started - car.classPlace >= 0 ? "+" : ""}${started - car.classPlace}`
      : dash,
    startPosition: started ? `from P${started}` : dash,
    bars: times.map((l) => ({
      h: 8 + ((l.time - min) / (max - min || 1)) * 62,
      c: l.clean ? (l.time === min ? "#3DDC84" : "#A3ADB8") : "#ffffff38",
      delay: "0ms",
    })),
    firstLapLabel: times.length ? `L${times[0].lap}` : dash,
    lastLapLabel: times.length ? `L${times.at(-1).lap}` : dash,
    lapCount: car?.laps ?? dash,
    pitStops: car?.pitStops ?? dash,
    lastPit: data?.lastPit ? `last on L${data.lastPit}` : "",
    limits:
      finite(p?.limits) && data.limitStep > 0
        ? (p.limits / data.limitStep).toFixed(1)
        : dash,
    limitMax: data?.limitStep > 0 ? data.limitMax / data.limitStep : dash,
  };
}
module.exports = { TelemetryModel, valuesFor, time, classCode, make };
