const finite = (value) => typeof value === "number" && Number.isFinite(value);

function movement(car, scoringTime) {
  const live = car?.liveProgress;
  if (
    !live ||
    car.pit ||
    !finite(scoringTime) ||
    !finite(live.et) ||
    live.et < scoringTime ||
    live.et - scoringTime > 0.5 ||
    !finite(live.travel) ||
    Math.abs(live.travel) > 100 ||
    !finite(live.speed)
  )
    return null;
  return live;
}

function relativeDistance(car, player, scoringTime, length) {
  if (!(length > 0) || !finite(car?.distance) || !finite(player?.distance))
    return null;
  const a = movement(car, scoringTime),
    b = movement(player, scoringTime);
  // Apply both samples together, at comparable times. Mixing a fresh player
  // position with a stale opponent would create a false closing-speed signal.
  const correction =
    a && b && Math.abs(a.et - b.et) <= 0.05 ? a.travel - b.travel : 0;
  const distance = car.distance - player.distance + correction;
  return ((((distance + length / 2) % length) + length) % length) - length / 2;
}

function leaderboardGap(car, leader, scoringTime) {
  if (!finite(car?.behind) || !finite(leader?.behind))
    return { value: null, estimated: false };
  const official = car.behind - leader.behind;
  const a = movement(car, scoringTime),
    b = movement(leader, scoringTime);
  if (!a || !b || a.speed < 5 || b.speed < 5 || Math.abs(a.et - b.et) > 0.05)
    return { value: official, estimated: false };
  // Keep the official scored gap as the anchor. Only estimate the short change
  // since that scoring sample, then re-anchor when new scoring arrives.
  const correction = (b.travel - a.travel) / b.speed;
  return {
    value: Math.max(0, official + correction),
    estimated: Math.abs(correction) >= 0.0005,
  };
}

module.exports = { relativeDistance, leaderboardGap, movement };
