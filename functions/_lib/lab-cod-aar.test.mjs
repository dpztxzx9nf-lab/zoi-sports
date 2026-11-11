import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMode, parseOcrPayload, reviewOf, OCR_CONFIDENCE_MIN, UNRECOGNIZED_MODE } from "./lab-cod-aar.js";

test("mode aliases map onto the catalog and do not invent one", () => {
  assert.equal(normalizeMode("Team Deathmatch"), "tdm");
  assert.equal(normalizeMode("DMZ"), "dmz");
  assert.equal(normalizeMode("Search & Destroy"), "search_and_destroy");
  assert.equal(normalizeMode("Warzone Resurgence"), "resurgence");
  assert.equal(normalizeMode("not a playlist"), null);
});

test("a confident DMZ scoreboard becomes a row that does not need review", () => {
  const parsed = parseOcrPayload({
    mode: "DMZ",
    kills: 7,
    deaths: 2,
    score: 4500,
    extracted: true,
    won: null,
    confidence: 0.92,
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "dmz");
  assert.equal(parsed.kills, 7);
  assert.equal(parsed.extracted, 1);
  assert.equal(parsed.won, null);
  const review = reviewOf(parsed);
  assert.equal(review.needs_review, 0);
});

test("a TDM win with low confidence is flagged", () => {
  const parsed = parseOcrPayload({
    mode: "tdm",
    kills: 18,
    deaths: 9,
    won: true,
    confidence: OCR_CONFIDENCE_MIN - 0.2,
  });
  const review = reviewOf(parsed);
  assert.equal(review.needs_review, 1);
  assert.ok(review.reasons.some((r) => /confident/i.test(r)));
});

test("a desktop that is not a scoreboard stays in review with no invented kills", () => {
  const parsed = parseOcrPayload({
    mode: null,
    kills: null,
    deaths: null,
    score: null,
    extracted: null,
    won: null,
    confidence: 0,
    notes: "desktop, not a scoreboard",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, UNRECOGNIZED_MODE);
  assert.equal(parsed.kills, null);
  assert.equal(reviewOf(parsed).needs_review, 1);
});

test("fenced JSON from a model is accepted", () => {
  const parsed = parseOcrPayload("```json\n{\"mode\":\"Hardpoint\",\"kills\":12,\"deaths\":8,\"won\":false,\"confidence\":0.88}\n```");
  assert.equal(parsed.mode, "hardpoint");
  assert.equal(parsed.kills, 12);
  assert.equal(parsed.won, 0);
  assert.equal(reviewOf(parsed).needs_review, 0);
});
