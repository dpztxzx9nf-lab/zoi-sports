import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMode, parseOcrPayload, modelTextOf, mergeMatchReads,
  majorityValue, applyPlacementWon, fieldsNeedingCrop, statsJson,
  UNRECOGNIZED_MODE,
} from "./lab-cod-aar.js";

test("mode aliases map onto the catalog and do not invent one", () => {
  assert.equal(normalizeMode("Team Deathmatch"), "tdm");
  assert.equal(normalizeMode("DMZ"), "dmz");
  assert.equal(normalizeMode("Search & Destroy"), "search_and_destroy");
  assert.equal(normalizeMode("Warzone Resurgence"), "resurgence");
  assert.equal(normalizeMode("not a playlist"), null);
});

test("a Resurgence bar with every labeled stat is stored, including zeros and damage", () => {
  const parsed = parseOcrPayload({
    mode: "RESURGENCE SOLOS",
    mode_label: "RESURGENCE SOLOS",
    placement: 31,
    kills: 1,
    deaths: 2,
    assists: 0,
    contracts: 0,
    damage: 502,
    won: false,
    confidence: 1,
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "resurgence");
  assert.equal(parsed.kills, 1);
  assert.equal(parsed.deaths, 2);
  assert.equal(parsed.assists, 0);
  assert.equal(parsed.contracts, 0);
  assert.equal(parsed.damage, 502);
  assert.equal(parsed.won, 0);
  assert.equal(parsed.placement, 31);
  assert.equal(statsJson(parsed).damage, 502);
});

test("total_damage is treated as damage, not score", () => {
  const parsed = parseOcrPayload({
    mode: "resurgence",
    total_damage: 502,
    score: null,
    confidence: 1,
  });
  assert.equal(parsed.damage, 502);
  assert.equal(parsed.score, null);
});

test("majority agrees when local frames and the model match", () => {
  const local = parseOcrPayload({ mode: "resurgence", kills: 1, deaths: 2, placement: 31, damage: 502, won: false, confidence: 1 });
  const vision = parseOcrPayload({ mode: "resurgence", kills: 1, deaths: 2, placement: 31, damage: 502, won: false, confidence: 1 });
  const merged = mergeMatchReads([local, vision]);
  assert.equal(merged.kills, 1);
  assert.equal(merged.deaths, 2);
  assert.equal(merged.placement, 31);
  assert.equal(merged.won, 0);
  assert.equal(merged.damage, 502);
});

test("a 1-1 split stays null rather than inventing a number", () => {
  assert.equal(majorityValue([1, 3]), null);
  assert.equal(majorityValue([1]), 1);
  assert.equal(majorityValue([1, 1, 3]), 1);
});

test("when local and vision disagree, a crop that matches one side wins", () => {
  const local = parseOcrPayload({ mode: "resurgence", kills: 1, deaths: 2, assists: 0, contracts: 0, placement: 31, damage: 502, confidence: 1 });
  const vision = parseOcrPayload({ mode: "resurgence", kills: null, deaths: null, placement: 31, damage: 502, confidence: 1 });
  assert.ok(fieldsNeedingCrop(local, vision).includes("kills"));
  const crop = parseOcrPayload({ mode: "resurgence", kills: 1, deaths: 2, assists: 0, contracts: 0, placement: 31, damage: 502, confidence: 1 });
  const merged = mergeMatchReads([local, vision, crop]);
  assert.equal(merged.kills, 1);
  assert.equal(merged.deaths, 2);
  assert.equal(merged.assists, 0);
  assert.equal(merged.contracts, 0);
  assert.equal(merged.damage, 502);
  assert.equal(merged.won, 0);
});

test("placement greater than 1 is a loss for Resurgence", () => {
  const row = applyPlacementWon({ mode: "resurgence", placement: 31, won: 1 });
  assert.equal(row.won, 0);
  const win = applyPlacementWon({ mode: "resurgence", placement: 1, won: null });
  assert.equal(win.won, 1);
});

test("fenced JSON from a model is accepted", () => {
  const parsed = parseOcrPayload("```json\n{\"mode\":\"Hardpoint\",\"kills\":12,\"deaths\":8,\"won\":false,\"confidence\":0.88}\n```");
  assert.equal(parsed.mode, "hardpoint");
  assert.equal(parsed.kills, 12);
  assert.equal(parsed.won, 0);
});

test("an OpenAI-style Workers AI wrapper still yields a match row", () => {
  const wrapped = {
    choices: [{
      finish_reason: "stop",
      message: { content: "{\"mode\":\"Team Deathmatch\",\"kills\":11,\"deaths\":4,\"won\":true,\"confidence\":0.9}" },
    }],
  };
  const parsed = parseOcrPayload(modelTextOf(wrapped));
  assert.equal(parsed.mode, "tdm");
  assert.equal(parsed.kills, 11);
  assert.equal(parsed.won, 1);
});

test("an unrecognized screen does not invent kills", () => {
  const parsed = parseOcrPayload({
    mode: null, kills: null, deaths: null, confidence: 0, notes: "desktop",
  });
  assert.equal(parsed.mode, UNRECOGNIZED_MODE);
  assert.equal(parsed.kills, null);
});

test("model keys with trailing colons and 31ST PLACE still parse, and unrecognized votes do not wipe the mode", () => {
  const vision = parseOcrPayload({
    "mode": "resurgence",
    "mode_label": "RESURGENCE SOLOS",
    "kills:": 1,
    "deaths:": 2,
    "assists:": 0,
    "contracts:": 0,
    "damage:": 502,
    "placement:": "31ST PLACE",
    "won:": false,
    "confidence": 1,
  });
  assert.equal(vision.mode, "resurgence");
  assert.equal(vision.kills, 1);
  assert.equal(vision.placement, 31);
  assert.equal(vision.won, 0);
  const local = parseOcrPayload({ mode: "unrecognized", deaths: 2, damage: 502, placement: 81, won: 0, confidence: 0 });
  const crop = parseOcrPayload({ mode: "warzone", kills: 1, deaths: 2, assists: 0, contracts: 0, placement: 31, damage: 502, extracted: true, confidence: 0 });
  const merged = mergeMatchReads([local, vision, crop]);
  assert.equal(merged.mode, "resurgence");
  assert.equal(merged.placement, 31);
  assert.equal(merged.kills, 1);
  assert.equal(merged.deaths, 2);
  assert.equal(merged.assists, 0);
  assert.equal(merged.contracts, 0);
  assert.equal(merged.damage, 502);
  assert.equal(merged.won, 0);
  assert.equal(merged.extracted, null);
});
