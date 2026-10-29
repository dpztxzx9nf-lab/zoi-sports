/* Player profiles: the card on the roster, editable from the lab.

   One person, one row, keyed by the owner email the Access token carries - the
   same scoping every lab table uses - so nobody can edit anyone else's card.

   Two rules live here rather than in the handlers, because both the editor and
   the public page depend on them agreeing:

   1. A field is either a trimmed string inside its limit or it is null. An empty
      string becomes null, so "cleared" and "never set" are one state and the
      page does not have to test for both.
   2. A social is an https URL or it is dropped. A profile is public, so a
      javascript: or data: value must never reach the page even if it somehow
      got past the form - the page re-checks with socialUrl() before using one. */

import { mediaUrl } from "./media.js";

export const NETWORKS = ["x", "tiktok", "youtube", "instagram", "twitch", "kick"];

export const LIMITS = {
  gamertag: 32,
  role: 40,
  region: 24,
  platform: 24,
  bio: 400,
  url: 200,
};

/* Lowercase, letters and digits only, dashes between words. The slug is the
   avatar filename and the roster key, so it has to be a safe path segment. */
export function slugOf(text) {
  const base = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return base || "player";
}

/* One text field: trimmed, collapsed whitespace, cut to its limit, empty -> null.
   Newlines are dropped from every single-line field; a bio keeps them. */
export function textField(value, max, { multiline = false } = {}) {
  if (typeof value !== "string") return null;
  let s = value.replace(multiline ? /\r\n?/g : /\s+/g, multiline ? "\n" : " ").trim();
  if (multiline) s = s.replace(/\n{3,}/g, "\n\n");
  if (!s) return null;
  return s.slice(0, max);
}

/* An https URL, or null. The protocol test is the point: everything else about
   a URL is the browser's business, but the scheme decides whether a link is a
   link or a way to run code on the page. */
export function socialUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (!url.hostname || url.hostname === "localhost") return null;
  return url.href.slice(0, LIMITS.url);
}

/* The socials object, filtered to known networks with valid URLs. Unknown keys
   are dropped rather than stored, so the table cannot accumulate a link the page
   will never draw and nobody can remove from the editor. */
export function socialsOf(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const net of NETWORKS) {
    const url = socialUrl(value[net]);
    if (url) out[net] = url;
  }
  return out;
}

export function socialsFromText(text) {
  if (typeof text !== "string" || !text.trim()) return {};
  try { return socialsOf(JSON.parse(text)); } catch { return {}; }
}

/* One row as the page sees it. `owner` is deliberately not included: the public
   side has no business knowing an email, and the editor already knows its own. */
export function publicProfile(row) {
  if (!row) return null;
  const out = {
    slug: row.slug,
    gamertag: row.gamertag,
    role: row.role || null,
    region: row.region || null,
    platform: row.platform || null,
    bio: row.bio || null,
    socials: socialsFromText(row.socials),
    updated_at: row.updated_at || null,
    /* The addresses are derived, not stored: the row keeps when a picture was
       saved, and the address is built from that and the slug. A row read without
       those columns - an older query, or a database before 0012 - has no
       timestamp, so it has no picture, which is exactly right. */
    avatar: mediaUrl(row.slug, "avatar", row.avatar_at),
    banner: mediaUrl(row.slug, "banner", row.banner_at),
  };
  /* Whether this player has a game settings page. Only the roster query joins
     player_settings to answer that, so it is added only when the column is
     really there - the lab's own profile read has no such column, and inventing
     a false for it there would be a claim about a query that never asked. */
  if (row.has_settings !== undefined) out.settings = row.has_settings === 1 || row.has_settings === true;
  return out;
}
