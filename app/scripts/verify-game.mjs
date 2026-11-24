import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as rules from "../src/logic.js";

const { meta, setup, validateAction, applyAction, isGameOver, viewFor } = rules;
const PLAYER = "player-one";
let groups = 0;
const CHART = setup([PLAYER]);
const F = CHART.notes[0].t;      // first note (lane 0)
const T2 = CHART.notes[2].t;     // third note (lane 2)
function check(name, fn) {
  fn();
  groups += 1;
  console.log("PASS " + name);
}
function step(state, action, player = PLAYER) {
  assert.deepEqual(validateAction(state, player, action), { ok: true });
  return applyAction(state, player, action);
}
function tap(state, at, lane) {
  return step(state, { type: "tap", at, lane });
}
function frozen(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(frozen);
  }
  return value;
}
function replay(actions) {
  return actions.reduce((state, action) => step(state, action), setup([PLAYER]));
}

check("six exports and identical client/server rules", () => {
  assert.deepEqual(Object.keys(rules).sort(), [
    "meta", "setup", "validateAction", "applyAction", "isGameOver", "viewFor",
  ].sort());
  assert.deepEqual(meta, { game: "Iischi Party", minPlayers: 1, maxPlayers: 1 });
  assert.equal(
    readFileSync(new URL("../src/logic.js", import.meta.url), "utf8"),
    readFileSync(new URL("../public/logic.js", import.meta.url), "utf8"),
  );
});

check("deterministic beat chart for every track tempo", () => {
  const state = setup([PLAYER]);
  assert.deepEqual(state, setup([PLAYER]));
  assert.equal(state.bpm, 124);
  assert.equal(state.notes.length, 84);
  assert.equal(state.notes[0].t, 1935);
  assert.equal(state.notes.at(-1).t, 43548);
  assert.equal(setup([PLAYER], { bpm: "abc" }).bpm, 124);
  assert.equal(setup([PLAYER], { bpm: 60 }).bpm, 121);
  assert.equal(setup([PLAYER], { bpm: 999 }).bpm, 160);
  for (const bpm of [121, 124, 126, 128, 132, 160]) {
    const chart = setup([PLAYER], { bpm });
    const beatMs = 60000 / bpm;
    assert.equal(chart.notes.length, 84);
    assert.ok(chart.notes.every((note, index, notes) =>
      note.id === index && note.status === 0 && Number.isInteger(note.t) &&
      note.lane >= 0 && note.lane <= 2 &&
      Number.isInteger(note.beat * 2) &&                       // on whole or half beats
      note.t === Math.round(note.beat * beatMs) &&             // exactly on the music grid
      (index === 0 || note.beat - notes[index - 1].beat >= 0.5)
    ));
    assert.ok(chart.notes.at(-1).t + 180 < 45000);
    assert.deepEqual(JSON.parse(JSON.stringify(chart)), chart);
  }
});

check("inclusive hit windows and precision scoring", () => {
  for (const offset of [-180, -125, -65, 0, 65, 125, 180]) {
    const state = tap(setup([PLAYER]), F + offset, 0);
    assert.equal(state.hits, 1);
    assert.equal(state.notes[0].status, 1);
    assert.equal(state.score, Math.round(100 - Math.abs(offset) * 0.25));
    assert.equal(state.totalDeviation, Math.abs(offset));
    assert.equal(state.lastEvent.quality,
      Math.abs(offset) <= 65 ? "perfect" : Math.abs(offset) <= 125 ? "good" : "close");
  }
  for (const offset of [-181, 181]) {
    const state = tap(setup([PLAYER]), F + offset, 0);
    assert.equal(state.hits, 0);
    assert.equal(state.score, 0);
    assert.equal(state.lastEvent.kind, "wrong");
    assert.equal(state.notes[0].status, offset > 0 ? 2 : 0);
  }
});

check("hostile actions, spectator input and backwards time are rejected", () => {
  const state = setup([PLAYER]);
  assert.equal(validateAction(state, "spectator", { type: "tap", at: F, lane: 0 }).error, "not_player");
  for (const at of [NaN, Infinity, -Infinity, -1, 45001, 0.5, "2000", null]) {
    assert.equal(validateAction(state, PLAYER, { type: "tick", at }).error, "invalid_time");
  }
  for (const lane of [-1, 3, 0.1, NaN, "0", null]) {
    assert.equal(validateAction(state, PLAYER, { type: "tap", at: F, lane }).error, "invalid_lane");
  }
  assert.equal(validateAction(state, PLAYER, null).error, "invalid_action");
  assert.equal(validateAction(state, PLAYER, []).error, "invalid_action");
  assert.equal(validateAction(state, PLAYER, { type: "reset", at: 0 }).error, "invalid_type");
  assert.equal(validateAction(state, PLAYER, { type: "finish", at: 44999 }).error, "finish_too_early");
  const advanced = step(state, { type: "tick", at: 100 });
  assert.equal(validateAction(advanced, PLAYER, { type: "tap", at: 99, lane: 0 }).error, "time_reversed");
  assert.deepEqual(validateAction(advanced, PLAYER, { type: "tick", at: 100 }), { ok: true });
});

check("global 90-ms lock closes multi-lane and repeat-input scoring", () => {
  const hit = tap(setup([PLAYER]), F, 0);
  assert.equal(hit.score, 100);
  for (const lane of [0, 1, 2]) {
    for (const at of [F, F + 50, F + 89]) {
      const action = { type: "tap", at, lane };
      assert.equal(validateAction(hit, PLAYER, action).error, "rate_limited");
      assert.deepEqual(applyAction(hit, PLAYER, action), hit);
    }
  }
  const repeat = tap(hit, F + 90, 0);
  assert.equal(repeat.hits, 1);
  assert.equal(repeat.score, 50);
  assert.equal(repeat.combo, 0);
  assert.equal(repeat.notes[0].status, 1);
  assert.equal(repeat.lastEvent.kind, "wrong");
  const wrongFirst = tap(setup([PLAYER]), F - 50, 1);
  assert.equal(validateAction(wrongFirst, PLAYER, { type: "tap", at: F, lane: 0 }).error, "rate_limited");
  assert.deepEqual(validateAction(wrongFirst, PLAYER, { type: "tap", at: F + 40, lane: 0 }), { ok: true });
});

check("misses reset combo before a later tap, with no repeated miss events", () => {
  let state = tap(setup([PLAYER]), F, 0);
  state = tap(state, T2, 2);
  assert.equal(state.hits, 2);
  assert.equal(state.misses, 1);
  assert.equal(state.combo, 1);
  assert.equal(state.score, 200);
  assert.equal(state.lastEvent.multiplier, 1);
  const missed = step(setup([PLAYER]), { type: "tick", at: F + 181 });
  assert.equal(missed.lastEvent.kind, "miss");
  assert.equal(missed.eventId, 1);
  const sameInstant = step(missed, { type: "tick", at: F + 181 });
  assert.equal(sameInstant.eventId, 1);
  assert.deepEqual(sameInstant, missed);
});

check("wrong taps reduce score and never produce negative values", () => {
  let state = tap(setup([PLAYER]), F, 0);
  for (const at of [F + 90, F + 180, F + 270]) state = tap(state, at, 2);
  assert.equal(state.score, 0);
  assert.equal(state.hits, 1);
  assert.equal(state.combo, 0);
  assert.equal(state.maxCombo, 1);
});

check("perfect round has 27600 points, 84 hits and bounded multiplier", () => {
  for (const bpm of [124, 126, 128, 132]) {
    let chart = setup([PLAYER], { bpm });
    for (const note of chart.notes) chart = tap(chart, note.t, note.lane);
    assert.equal(chart.score, 27600);
  }
  let state = setup([PLAYER]);
  for (const note of state.notes) state = tap(state, note.t, note.lane);
  assert.equal(state.score, 27600);
  assert.equal(state.hits, 84);
  assert.equal(state.misses, 0);
  assert.equal(state.combo, 84);
  assert.equal(state.maxCombo, 84);
  assert.equal(state.totalDeviation, 0);
  assert.equal(state.lastEvent.multiplier, 4);
  state = step(state, { type: "finish", at: 45000 });
  assert.equal(state.done, true);
  assert.deepEqual(isGameOver(state), { over: true, winner: PLAYER });
  assert.equal(validateAction(state, PLAYER, { type: "tick", at: 45000 }).error, "game_over");
  assert.equal(state.score, 27600);
});

check("no-input finish and last-window boundaries account for all notes", () => {
  const empty = step(setup([PLAYER]), { type: "tick", at: 45000 });
  assert.equal(empty.done, true);
  assert.equal(empty.hits, 0);
  assert.equal(empty.misses, 84);
  assert.equal(empty.score, 0);
  assert.ok(empty.notes.every((note) => note.status === 2));
  let state = setup([PLAYER]);
  const last = state.notes.at(-1);
  state = tap(state, last.t + 180, last.lane);
  assert.equal(state.hits, 1);
  assert.equal(state.misses, 83);
  assert.equal(state.score, 55);
  assert.equal(state.done, false);
  state = step(state, { type: "finish", at: 45000 });
  assert.equal(state.hits + state.misses, 84);
  const tooLate = tap(setup([PLAYER]), last.t + 181, last.lane);
  assert.equal(tooLate.hits, 0);
  assert.equal(tooLate.misses, 84);
});

check("immutable input, defensive views, deterministic replay and reset", () => {
  const players = [PLAYER];
  const initial = frozen(setup(players));
  players[0] = "changed";
  assert.equal(initial.players[0], PLAYER);
  const snapshot = JSON.stringify(initial);
  const next = tap(initial, F, 0);
  assert.equal(JSON.stringify(initial), snapshot);
  assert.notEqual(next, initial);
  assert.notEqual(next.notes, initial.notes);
  const view = viewFor(next, PLAYER);
  view.players[0] = "changed";
  view.notes[0].status = 2;
  view.lastEvent.kind = "changed";
  assert.equal(next.players[0], PLAYER);
  assert.equal(next.notes[0].status, 1);
  assert.equal(next.lastEvent.kind, "hit");
  const actions = [
    { type: "tap", at: F, lane: 0 },
    { type: "tick", at: F + 1000 },
    { type: "tap", at: T2, lane: 2 },
    { type: "finish", at: 45000 },
  ];
  assert.deepEqual(replay(actions), replay(actions));
  assert.deepEqual(setup([PLAYER]), initial);
  assert.deepEqual(isGameOver(initial), { over: false });
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});
console.log("Verified " + groups + " rule groups.");

