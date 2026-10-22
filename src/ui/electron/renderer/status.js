export function statusView(status) {
  const titles = {
    idle: "Waiting for LMU",
    waiting: "Waiting for driving",
    starting: "Connecting",
    active: "Connected",
    paused: "Waiting for driving",
    stopping: "Disconnecting",
    stopped: "Disconnected",
    session_ended: "Ready to reactivate",
    error: "Connection stopped",
    blocked: "Active Reset unavailable",
  };
  const saved = status.checkpoint === true;
  const speed =
    saved &&
    Number.isFinite(status.saved_speed_kmh) &&
    status.saved_speed_kmh >= 0
      ? Math.round(status.saved_speed_kmh).toLocaleString("en-GB")
      : "-";
  return {
    title: titles[status.phase] || "Waiting for LMU",
    tone:
      status.phase === "active"
        ? "connected"
        : status.phase === "error" || status.phase === "blocked"
          ? "error"
          : "waiting",
    saved,
    speed,
    count:
      saved &&
      Number.isSafeInteger(status.restore_count) &&
      status.restore_count >= 0
        ? status.restore_count
        : 0,
    time:
      saved && Number.isFinite(status.saved_at)
        ? new Date(status.saved_at * 1000).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "-",
    message: typeof status.message === "string" ? status.message : "",
  };
}
