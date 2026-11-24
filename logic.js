/**
 * Iischi Party: deterministic rules shared by the room and the mobile client.
 * All times are integer milliseconds within the current 45-second round.
 */
export const meta = {
  game: "Iischi Party",
  minPlayers: 1,
  maxPlayers: 1,
};

const DURATION = 45000;
const HIT_WINDOW = 180;
const INPUT_LOCK = 90;

function copyState(state) {
  return {
    ...state,
    players: [...state.players],
    notes: state.notes.map((note) => ({ ...note })),
    lastEvent: { ...state.lastEvent },
  };
}

function emit(state, event) {
  state.eventId += 1;
  state.lastEvent = event;
}

// The chart is written in beats, so every note lands exactly on the music's grid
// (whole beats, and half beats in the finale). Every track uses the same 84 notes,
// so scores stay comparable across tracks. Tempo range keeps the last note inside 45 s.
const MIN_BPM = 121;
const MAX_BPM = 160;
const DEFAULT_BPM = 124;
const LEAD_BEATS = 4;
const SECTIONS = [
  { count: 16, steps: [2], lanes: [0, 1, 2, 1, 0, 2, 1, 2] },
  { count: 28, steps: [1], lanes: [2, 0, 1, 2, 1, 0, 2, 0, 1, 0] },
  { count: 40, steps: [1, 0.5, 0.5], lanes: [0, 2, 1, 0, 1, 2, 0, 2, 1, 2, 0, 1] },
];

function chartBpm(options) {
  const bpm = options && typeof options === "object" ? Number(options.bpm) : DEFAULT_BPM;
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm * 100) / 100));
}

export function setup(players, options) {
  const bpm = chartBpm(options);
  const beatMs = 60000 / bpm;
  const notes = [];
  let beat = LEAD_BEATS;
  SECTIONS.forEach((section, sectionIndex) => {
    if (sectionIndex === 1) beat = Math.ceil(beat);
    if (sectionIndex === 2) beat = Math.ceil(beat);
    for (let index = 0; index < section.count; index += 1) {
      notes.push({
        id: notes.length,
        t: Math.round(beat * beatMs),
        beat,
        lane: section.lanes[index % section.lanes.length],
        status: 0,
      });
      beat += section.steps[index % section.steps.length];
    }
  });
  return {
    players: Array.isArray(players) ? players.slice(0, 1) : [],
    duration: DURATION,
    bpm,
    notes,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    lastAt: 0,
    lastInputAt: -1000,
    totalDeviation: 0,
    done: false,
    eventId: 0,
    lastEvent: { kind: "ready" },
  };
}

export function validateAction(state, playerId, action) {
  if (!state || !Array.isArray(state.players) || !Array.isArray(state.notes)) {
    return { ok: false, error: "invalid_state" };
  }
  if (state.players.length !== 1 || state.players[0] !== playerId) {
    return { ok: false, error: "not_player" };
  }
  if (state.done) return { ok: false, error: "game_over" };
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return { ok: false, error: "invalid_action" };
  }
  if (action.type !== "tick" && action.type !== "tap" && action.type !== "finish") {
    return { ok: false, error: "invalid_type" };
  }
  if (!Number.isInteger(action.at) || action.at < 0 || action.at > DURATION) {
    return { ok: false, error: "invalid_time" };
  }
  if (action.at < state.lastAt) return { ok: false, error: "time_reversed" };
  if (action.type === "finish" && action.at !== DURATION) {
    return { ok: false, error: "finish_too_early" };
  }
  if (action.type === "tap") {
    if (!Number.isInteger(action.lane) || action.lane < 0 || action.lane > 2) {
      return { ok: false, error: "invalid_lane" };
    }
    if (action.at - state.lastInputAt < INPUT_LOCK) {
      return { ok: false, error: "rate_limited" };
    }
  }
  return { ok: true };
}

export function applyAction(state, playerId, action) {
  const checked = validateAction(state, playerId, action);
  if (!checked.ok) return copyState(state);

  const next = copyState(state);
  next.lastAt = action.at;
  let newlyMissed = 0;

  for (const note of next.notes) {
    if (note.status === 0 && (action.at - note.t > HIT_WINDOW || action.at === DURATION)) {
      note.status = 2;
      newlyMissed += 1;
    }
  }
  if (newlyMissed > 0) {
    next.misses += newlyMissed;
    next.combo = 0;
    emit(next, { kind: "miss" });
  }

  if (action.at === DURATION) {
    next.done = true;
    return next;
  }
  if (action.type !== "tap") return next;

  // One global input window covers touch, keyboard and mixed input methods.
  next.lastInputAt = action.at;
  let candidate = null;
  let deviation = HIT_WINDOW + 1;
  for (const note of next.notes) {
    if (note.status !== 0 || note.lane !== action.lane) continue;
    const distance = Math.abs(note.t - action.at);
    if (distance <= HIT_WINDOW && distance < deviation) {
      candidate = note;
      deviation = distance;
    }
  }

  if (candidate) {
    candidate.status = 1;
    next.hits += 1;
    next.combo += 1;
    next.maxCombo = Math.max(next.maxCombo, next.combo);
    next.totalDeviation += deviation;
    const multiplier = Math.min(4, 1 + Math.floor((next.combo - 1) / 10));
    const points = Math.round(100 - deviation * 0.25) * multiplier;
    const quality = deviation <= 65 ? "perfect" : deviation <= 125 ? "good" : "close";
    next.score += points;
    emit(next, { kind: "hit", quality, lane: action.lane, points, multiplier });
  } else {
    next.score = Math.max(0, next.score - 50);
    next.combo = 0;
    emit(next, { kind: "wrong", lane: action.lane });
  }
  return next;
}

export function isGameOver(state) {
  return state.done
    ? { over: true, winner: state.players[0] ?? null }
    : { over: false };
}

export function viewFor(state, playerId) {
  // The single-player chart has no hidden information. Observers get a copy.
  return copyState(state);
}

