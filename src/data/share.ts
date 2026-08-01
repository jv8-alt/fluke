/**
 * URL-fragment share codec — "Copy link" turns the current view into a URL.
 *
 * The whole app is static (no backend, by design — see MIKADO.md), so a share
 * link must carry its state in the URL itself. We use the FRAGMENT (`#...`)
 * rather than the query string on purpose:
 *
 *   - fragments never leave the browser (not sent to the server, not logged
 *     by hosts/CDNs) — which matters because a link can embed the user's own
 *     uploaded CSV, and that data should stay client-side end to end;
 *   - changing a fragment doesn't reload a static page.
 *
 * Format: a plain `key=value&key=value` string (no leading '#'), human-
 * readable for the common case, e.g.
 *
 *     ds=paper&bars=1&clust=0&pair=1&step=3
 *
 * plus an optional `csv=` parameter holding the raw uploaded CSV text as
 * URL-safe base64 when the shared dataset is an upload (ds === "upload").
 *
 * Encoding choice: plain base64 of the UTF-8 bytes, NOT compression. The
 * plan's original sketch used lz-string, but this branch may not add npm
 * dependencies (package.json is outside its file boundary), and a hand-rolled
 * compressor is exactly the kind of subtle code this project shouldn't own.
 * Compression is a possible follow-up; the 6 kB size guard below keeps
 * uncompressed links honest in the meantime.
 *
 * Robustness contract: decodeShare NEVER throws. Share links arrive from the
 * wild — truncated by chat apps, mangled by "smart" quote substitution,
 * hand-edited — and a bad link should fall back to the default view, not
 * crash the app. Any malformed input → null.
 */

/** Everything "Copy link" captures about the current view. */
export interface ShareState {
  /** dataset id: "paper", "drop", "mmlu", or "upload" */
  ds: string;
  /** the three correction toggles (margins / clustering / pairing) */
  bars: boolean;
  clust: boolean;
  pair: boolean;
  /** 1-based tour step when sharing mid-story; absent = explore mode */
  step?: number;
  /** raw uploaded CSV text, present only when ds === "upload" */
  csv?: string;
}

/**
 * Links longer than this get a friendly refusal from shareableOrReason.
 * Browsers and chat apps start misbehaving somewhere past ~8k characters
 * (old Edge/IE limits, link unfurlers truncating); 6000 leaves headroom for
 * the origin/path portion of the URL on top of the fragment.
 */
export const MAX_FRAGMENT_CHARS = 6000;

// ---------------------------------------------------------------------------
// URL-safe base64 for arbitrary (unicode) text
// ---------------------------------------------------------------------------

/**
 * btoa/atob only speak latin-1, so unicode CSV content (model names, accented
 * item ids…) must go through UTF-8 bytes first. We also swap +/ for -_ and
 * drop '=' padding: '+' and '=' have meanings inside a key=value&… fragment,
 * and '/' is just asking for trouble with naive URL handling.
 */
function textToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // Build the binary string in chunks — String.fromCharCode(...bigArray)
  // overflows the argument limit on large uploads.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of textToBase64Url. Throws on invalid base64 — callers catch. */
function base64UrlToText(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  // atob tolerates missing padding in some engines but not all — restore it.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // fatal: true → malformed UTF-8 throws instead of silently yielding U+FFFD,
  // so a corrupted payload surfaces as "bad link" rather than garbled data.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode view state into a fragment string (WITHOUT the leading '#' — the
 * caller owns URL assembly). Always encodes, whatever the size; use
 * shareableOrReason when you need the size guard.
 */
export function encodeShare(state: ShareState): string {
  const parts: string[] = [
    // encodeURIComponent on ds: dataset ids are simple today, but a future id
    // containing '&' or '=' must not be able to smuggle extra parameters.
    `ds=${encodeURIComponent(state.ds)}`,
    `bars=${state.bars ? 1 : 0}`,
    `clust=${state.clust ? 1 : 0}`,
    `pair=${state.pair ? 1 : 0}`,
  ];
  // Optional fields are simply omitted, keeping the common-case link short
  // and readable — a design goal, since people eyeball links before clicking.
  if (state.step !== undefined) parts.push(`step=${state.step}`);
  if (state.csv !== undefined) parts.push(`csv=${textToBase64Url(state.csv)}`);
  return parts.join("&");
}

/**
 * The user-facing entry point for "Copy link": refuses (with a reason a
 * person can act on) instead of minting a link that will break in transit.
 */
export function shareableOrReason(
  state: ShareState,
): { ok: true; fragment: string } | { ok: false; reason: string } {
  const fragment = encodeShare(state);
  if (fragment.length > MAX_FRAGMENT_CHARS) {
    return {
      ok: false,
      reason:
        "This dataset is too large to fit in a link — share the CSV file itself instead. " +
        "(Links can carry small uploads; bigger ones would get cut off by chat apps and browsers.)",
    };
  }
  return { ok: true, fragment };
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode a fragment (with or without a leading '#', since location.hash
 * includes one) back into ShareState. Returns null on ANY malformed input —
 * missing required keys, non-boolean toggle values, non-numeric step, or an
 * undecodable csv payload. Unknown keys are ignored so that future versions
 * can add parameters without breaking old builds that receive their links.
 */
export function decodeShare(fragment: string): ShareState | null {
  try {
    const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    if (raw === "") return null;

    const params = new Map<string, string>();
    for (const pair of raw.split("&")) {
      // Split on the FIRST '=' only: base64 csv payloads survive '=' fine
      // (we strip padding, but hand-made links might not).
      const eq = pair.indexOf("=");
      if (eq <= 0) return null; // "foo" or "=bar" — not a key=value fragment
      const key = pair.slice(0, eq);
      if (params.has(key)) return null; // duplicate keys = mangled link
      params.set(key, pair.slice(eq + 1));
    }

    const ds = params.get("ds");
    if (ds === undefined || ds === "") return null;

    // Toggles must be exactly "0" or "1" — anything else means the link was
    // truncated or edited, and guessing at intent would misrepresent the view.
    const bool = (key: string): boolean | null => {
      const v = params.get(key);
      return v === "1" ? true : v === "0" ? false : null;
    };
    const bars = bool("bars");
    const clust = bool("clust");
    const pair = bool("pair");
    if (bars === null || clust === null || pair === null) return null;

    const state: ShareState = { ds: decodeURIComponent(ds), bars, clust, pair };

    const stepRaw = params.get("step");
    if (stepRaw !== undefined) {
      // Tour steps are small positive integers; reject "3.5", "-1", "NaN".
      if (!/^\d+$/.test(stepRaw)) return null;
      state.step = parseInt(stepRaw, 10);
    }

    const csvRaw = params.get("csv");
    if (csvRaw !== undefined) {
      if (csvRaw === "") return null; // ds=upload with an empty payload is a broken link
      state.csv = base64UrlToText(csvRaw); // throws on garbage → caught below
    }

    return state;
  } catch {
    // Single catch-all keeps the never-throw contract in one obvious place:
    // atob/decodeURIComponent/TextDecoder all throw on malformed input.
    return null;
  }
}
