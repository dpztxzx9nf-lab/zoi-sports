import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMode, parseOcrPayload, modelTextOf, mergeMatchReads,
  majorityValue, applyPlacementWon, fieldsNeedingCrop, statsJson,
  maskCropRead, inferMode, recoverFieldsFromText, UNRECOGNIZED_MODE,
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

test("broken model JSON still recovers a visible 350 damage and 120th place", () => {
  const raw = "{\"confidence\": 0.1, \"mode\": \"resurgence\", \"mode_label\": \"Resurgence Solos\", \"kills: 0, \"damage: 350, \"contracts: 0, \"placement: \"  \\t: 120, \"won: false, \"notes: \"E/D ratio 0.00 and win streaks 0\"}";
  const parsed = parseOcrPayload(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kills, 0);
  assert.equal(parsed.damage, 350);
  assert.equal(parsed.placement, 120);
  assert.equal(parsed.contracts, 0);
  assert.equal(parsed.won, 0);
});

test("a weak crop 0 cannot override a confidently read 350, and must abstain rather than invent 0", () => {
  const vision = parseOcrPayload({ mode: "warzone", kills: 0, damage: 350, contracts: 0, placement: 120, ed_ratio: 0, winstreaks: 0, extracted: null, won: false, confidence: 0.8 });
  vision._weak = false;
  const footer = maskCropRead(parseOcrPayload({
    mode: "dmz", damage: 0, kills: 0, contracts: 0, extracted: true, confidence: 0,
  }), "footer");
  const header = maskCropRead(parseOcrPayload({
    extracted: true, mode: null, confidence: 0,
  }), "header");
  const merged = mergeMatchReads([vision, footer, header]);
  assert.equal(merged.damage, 350);
  assert.equal(merged.kills, 0);
  assert.equal(merged.contracts, 0);
  assert.equal(merged.placement, 120);
  assert.equal(merged.mode, "warzone");
  assert.equal(merged.extracted, null);
  assert.equal(merged.won, 0);
  assert.equal(merged.ed_ratio, 0);
  assert.equal(merged.winstreaks, 0);
});

test("a crop that cannot see damage abstains instead of voting 0, leaving a lone 0 as null", () => {
  const footer = maskCropRead(parseOcrPayload({ damage: 0, kills: 0, confidence: 0 }), "footer");
  const header = maskCropRead(parseOcrPayload({ extracted: true, confidence: 0 }), "header");
  const merged = mergeMatchReads([footer, header]);
  assert.equal(merged.damage, null);
  assert.equal(merged.extracted, null);
});

test("placement 120 with E/D tiles and no mode text is Warzone BR, not Resurgence", () => {
  const local = parseOcrPayload({ placement: 120, kills: 0, damage: 350, contracts: 0, ed_ratio: 0, winstreaks: 0, confidence: 1 });
  const merged = mergeMatchReads([local], { text: "120th place kills 0.00 e/d ratio damage contracts winstreaks" });
  assert.equal(merged.mode, "warzone");
  assert.equal(merged.placement, 120);
  assert.equal(merged.won, 0);
  assert.equal(merged.extracted, null);
  assert.equal(merged.ed_ratio, 0);
  assert.equal(merged.winstreaks, 0);
});

test("a last_mode from the lobby is used only when the AAR has no stronger signal", () => {
  const local = parseOcrPayload({ kills: 8, deaths: 4, won: true, confidence: 1 });
  const merged = mergeMatchReads([local], { lastMode: "tdm" });
  assert.equal(merged.mode, "tdm");
});

test("row 2 style Resurgence summary is unchanged: 31st, 1 kill, 2 deaths, 502 damage, loss", () => {
  const local = parseOcrPayload({ mode: "unrecognized", deaths: 2, damage: 502, placement: 31, won: 0, confidence: 0 });
  const vision = parseOcrPayload({
    mode: "resurgence",
    mode_label: "RESURGENCE SOLOS",
    "kills:": 1,
    "deaths:": 2,
    "assists:": 0,
    "contracts:": 0,
    "damage:": 502,
    "placement:": "31ST PLACE",
    "won:": false,
    confidence: 1,
  });
  const crop = maskCropRead(parseOcrPayload({
    mode: "warzone", kills: 1, deaths: 2, assists: 0, contracts: 0, placement: 31, damage: 502, extracted: true, confidence: 0,
  }), "footer");
  const merged = mergeMatchReads([local, vision, crop], { text: "RESURGENCE SOLOS 31ST PLACE MATCH SUMMARY" });
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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("screen fixtures name the expected Warzone and Resurgence results", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/cod-aar");
  const res = JSON.parse(readFileSync(join(dir, "resurgence-solos.json"), "utf8"));
  const br = JSON.parse(readFileSync(join(dir, "warzone-br-sting.json"), "utf8"));
  assert.equal(res.expected.mode, "resurgence");
  assert.equal(res.expected.placement, 31);
  assert.equal(res.expected.kills, 1);
  assert.equal(res.expected.deaths, 2);
  assert.equal(res.expected.damage, 502);
  assert.equal(res.expected.won, 0);
  assert.equal(br.expected.mode, "warzone");
  assert.equal(br.expected.placement, 120);
  assert.equal(br.expected.kills, 0);
  assert.equal(br.expected.deaths, null);
  assert.equal(br.expected.damage, 350);
  assert.equal(br.expected.contracts, 0);
  assert.equal(br.expected.ed_ratio, 0);
  assert.equal(br.expected.winstreaks, 0);
  assert.equal(br.expected.won, 0);
  assert.equal(br.expected.extracted, null);
});
