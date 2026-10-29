/* Profile pictures and banners: one place that decides what a picture is.
   ---------------------------------------------------------------------------
   Two things could disagree about an upload and both of them are dangerous:

   1. What the browser says the file is. A file picker will happily hand over a
      .png that is really a JPEG, a .jpg that is really a GIF, or a chunk of text
      with an image name. The declared content type is not evidence, so the type
      is read from the bytes - the few bytes every format starts with - and the
      stored content type is the one the bytes support, never the one claimed.
   2. How big it is. The browser shrinks and re-encodes before it uploads, but
      nothing stops a request being sent by hand, so the limit is enforced here
      on the decoded length, not on what the editor says it sent.

   What is stored is the bytes and the type; what says the picture exists is the
   timestamp on the player's row. Nothing stores a URL, because the address is
   derived from the slug and the timestamp - so moving a picture or replacing one
   cannot leave a stale address behind. */

/* The two pictures a player has, and the column that records when each was
   saved. The column is the presence: NULL means no picture. */
export const KINDS = ["avatar", "banner"];

export const COLUMNS = { avatar: "avatar_at", banner: "banner_at" };

/* 600 KB for the avatar and 1.2 MB for the banner, in bytes. The editor reduces
   a picture to well under these before it uploads; the ceiling is for the
   request that did not come from the editor. */
export const MAX_BYTES = { avatar: 600 * 1024, banner: 1200 * 1024 };

/* The slug is a path segment: lowercase letters, digits, dashes between them,
   at most the 32 characters slugOf() produces. Anything else never reaches R2. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const starts = (bytes, sig, at = 0) => {
  if (!bytes || bytes.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
  return true;
};

/* PNG, JPEG and WebP, identified by their own headers:
     PNG   89 50 4E 47 0D 0A 1A 0A   (the 8-byte signature, CRLF included)
     JPEG  FF D8 FF                  (SOI then the first marker)
     WebP  RIFF .... WEBP            ("WEBP" at offset 8, after the RIFF size)
   Returns the type the bytes are, or null for everything else - including a GIF,
   an SVG, and a text file wearing a .png name. */
export function sniffImage(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 12) return null;
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/* Whatever the request said the type was is discarded on purpose. This is the
   type that gets stored and served back. */
export const TYPE_LABEL = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP" };

const KB = (n) => Math.round(n / 1024) + " KB";

/* base64 in a data URL to bytes. atob is lenient about padding and whitespace in
   some engines, so the string is checked against the alphabet first: anything
   with a stray % or a newline in it is a malformed request, not a picture. */
function bytesOf(base64) {
  const raw = String(base64 || "").replace(/\s+/g, "");
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return null;
  let bin;
  try { bin = atob(raw); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* One upload, checked end to end. Answers either

     { ok: true, bytes, mime, size }
     { ok: false, error }              // error is a sentence to show a person

   The order matters for the message a person reads: the kind first (a request
   for "header" is a client bug, not a picture problem), then whether there are
   bytes at all, then the size, then what the bytes actually are. A 3 MB PNG
   should be told it is too big, not inspected for its magic number first. */
export function checkUpload(kind, data) {
  if (KINDS.indexOf(kind) === -1) return { ok: false, error: "Choose a profile picture or a banner." };
  if (typeof data !== "string" || !data) return { ok: false, error: "No picture was sent." };

  /* A data URL: "data:image/jpeg;base64,<body>". The declared media type is
     read and then deliberately not trusted - it is only used to find the body. */
  const comma = data.indexOf(",");
  const head = comma === -1 ? "" : data.slice(0, comma);
  if (!/^data:[^;,]*;base64$/i.test(head.replace(/\s+$/, ""))) {
    return { ok: false, error: "Send the picture as a base64 data URL." };
  }
  const bytes = bytesOf(data.slice(comma + 1));
  if (!bytes || !bytes.length) return { ok: false, error: "That picture came through empty." };

  const max = MAX_BYTES[kind];
  if (bytes.length > max) {
    return { ok: false, error: "That picture is " + KB(bytes.length) + ". The limit is " + KB(max) + "." };
  }

  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, error: "That file is not a JPEG, PNG or WebP image." };

  return { ok: true, bytes, mime, size: bytes.length };
}

/* The public address of a picture, or null when there is none. The stamp is the
   row's own timestamp, so a new upload gets a new address and a browser that
   cached the old one cannot keep showing it. */
export function mediaUrl(slug, kind, at) {
  if (!slug || !at) return null;
  if (KINDS.indexOf(kind) === -1) return null;
  return "/media/" + encodeURIComponent(String(slug)) + "/" + kind + "?v=" + encodeURIComponent(String(at));
}
