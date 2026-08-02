/**
 * Tests for the URL-fragment share codec (share.ts).
 *
 * The contract under test: every field round-trips encode→decode exactly;
 * decodeShare returns null (never throws) on anything malformed; and the
 * size guard refuses oversized payloads with an actionable reason.
 */

import { describe, expect, it } from "vitest";
import {
  decodeShare,
  encodeShare,
  MAX_FRAGMENT_CHARS,
  shareableOrReason,
  type ShareState,
} from "./share";

/**
 * Deterministic high-entropy CSV. Payloads are compressed now, so a fixture
 * built from repeated text no longer exercises the size guard at all — only
 * content compression can't shrink still does. Seeded LCG rather than
 * Math.random so a failure is always reproducible.
 */
function incompressibleCsv(rows: number): string {
  let seed = 987654321;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const tok = () => Math.floor(rand() * 2176782336).toString(36);
  const lines = ["model,item_id,score"];
  for (let i = 0; i < rows; i++) lines.push(`${tok()},${tok()}-${tok()},${rand().toFixed(8)}`);
  return lines.join("\n") + "\n";
}

describe("encodeShare / decodeShare — round trips", () => {
  it("round-trips the minimal common case and stays human-readable", () => {
    const state: ShareState = { ds: "paper", bars: true, clust: false, pair: true };
    const frag = encodeShare(state);
    // The readable format is part of the contract — people eyeball links.
    expect(frag).toBe("ds=paper&bars=1&clust=0&pair=1");
    expect(decodeShare(frag)).toEqual(state);
  });

  it("round-trips a mid-tour step", () => {
    const state: ShareState = { ds: "paper", bars: true, clust: true, pair: false, step: 3 };
    expect(encodeShare(state)).toContain("step=3");
    expect(decodeShare(encodeShare(state))).toEqual(state);
  });

  it("round-trips every toggle combination", () => {
    for (const bars of [true, false])
      for (const clust of [true, false])
        for (const pair of [true, false]) {
          const state: ShareState = { ds: "mmlu", bars, clust, pair };
          expect(decodeShare(encodeShare(state))).toEqual(state);
        }
  });

  it("round-trips an embedded uploaded CSV verbatim", () => {
    const csv = "model,item_id,score\r\nckpt-1600,q1,1\r\nckpt-1400,q1,0\r\n";
    const state: ShareState = { ds: "upload", bars: true, clust: false, pair: false, csv };
    const decoded = decodeShare(encodeShare(state));
    expect(decoded).toEqual(state);
    expect(decoded!.csv).toBe(csv); // byte-for-byte, CRLF included
  });

  it("round-trips unicode CSV content (base64 goes through UTF-8, not latin-1)", () => {
    const csv = "model,item_id,score\nmodèle-α,质问-1,0.5\n🤖-model,q✓,1\n";
    const state: ShareState = { ds: "upload", bars: false, clust: false, pair: false, csv };
    expect(decodeShare(encodeShare(state))!.csv).toBe(csv);
  });

  it("accepts a leading '#' (location.hash form)", () => {
    const state: ShareState = { ds: "drop", bars: true, clust: true, pair: true };
    expect(decodeShare("#" + encodeShare(state))).toEqual(state);
  });

  it("keeps the csv payload fragment-safe (no raw &, =, + or /)", () => {
    // Content chosen to force '+' and '/' in ordinary base64 output.
    const csv = "model,item_id,score\nÿþý,q&=+/1,0\n";
    const frag = encodeShare({ ds: "upload", bars: false, clust: false, pair: false, csv });
    const payload = frag.split("csv=")[1];
    expect(payload).not.toMatch(/[&=+/]/); // any of these would corrupt parsing
    expect(decodeShare(frag)!.csv).toBe(csv);
  });

  it("ignores unknown parameters (forward compatibility with future links)", () => {
    expect(decodeShare("ds=paper&bars=1&clust=0&pair=0&future=42")).toEqual({
      ds: "paper",
      bars: true,
      clust: false,
      pair: false,
    });
  });
});

describe("decodeShare — malformed input returns null, never throws", () => {
  const cases: [string, string][] = [
    ["empty string", ""],
    ["lone hash", "#"],
    ["arbitrary garbage", "!!!not-a-fragment!!!"],
    ["missing ds", "bars=1&clust=0&pair=0"],
    ["empty ds", "ds=&bars=1&clust=0&pair=0"],
    ["missing toggle", "ds=paper&bars=1&clust=0"],
    ["non-boolean toggle", "ds=paper&bars=yes&clust=0&pair=0"],
    ["truncated mid-value", "ds=paper&bars=1&clust=0&pair="],
    ["non-integer step", "ds=paper&bars=1&clust=0&pair=0&step=3.5"],
    ["negative step", "ds=paper&bars=1&clust=0&pair=0&step=-1"],
    ["keyless chunk", "ds=paper&bars=1&clust=0&pair=0&loose"],
    ["duplicate keys", "ds=paper&ds=drop&bars=1&clust=0&pair=0"],
    ["empty csv payload", "ds=upload&bars=1&clust=0&pair=0&csv="],
    ["csv payload that is not base64", "ds=upload&bars=1&clust=0&pair=0&csv=!!!!"],
    // Valid base64 characters but not valid UTF-8 bytes underneath (0xFF 0xFF…):
    ["csv payload that is not UTF-8", "ds=upload&bars=1&clust=0&pair=0&csv=____"],
    ["percent-garbage in ds", "ds=%zz&bars=1&clust=0&pair=0"],
  ];
  for (const [label, fragment] of cases) {
    it(`→ null for ${label}`, () => {
      expect(decodeShare(fragment)).toBeNull(); // and no throw, per contract
    });
  }

  it("→ null for a truncated csv payload (chat apps cut long links)", () => {
    // Honest caveat: truncation that happens to land on a 4-char base64 /
    // UTF-8 boundary is undetectable without a checksum (a follow-up if it
    // ever matters). Here we truncate to a length that is STRUCTURALLY
    // invalid base64 (length ≡ 1 mod 4), which must decode to null.
    const full = encodeShare({
      ds: "upload",
      bars: true,
      clust: false,
      pair: false,
      csv: "model,item_id,score\nüñí-model,q1,1\n",
    });
    const payloadLen = full.split("csv=")[1].length;
    const cut = payloadLen % 4 === 1 ? 4 : (payloadLen % 4) + 3; // land on ≡1 mod 4
    expect(decodeShare(full.slice(0, full.length - cut))).toBeNull();
  });
});

describe("shareableOrReason — size guard", () => {
  const base: ShareState = { ds: "upload", bars: true, clust: false, pair: false };

  it("passes a small uploaded CSV through unchanged", () => {
    const res = shareableOrReason({ ...base, csv: "model,item_id,score\na,q1,1\n" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fragment.length).toBeLessThanOrEqual(MAX_FRAGMENT_CHARS);
      expect(decodeShare(res.fragment)).toEqual({ ...base, csv: "model,item_id,score\na,q1,1\n" });
    }
  });

  it("compresses: a repetitive CSV far larger than the cap still fits", () => {
    // 1000 rows ≈ 27k characters — comfortably over the limit uncompressed,
    // but real eval CSVs repeat the same model and benchmark names on every
    // row, which is exactly what compression eats. This is the behaviour that
    // makes the bundled example shareable.
    const repetitive =
      "benchmark,model,item_id,score\n" +
      Array.from({ length: 1000 }, (_, i) => `reading,baseline-v1,q${i},1`).join("\n");
    expect(repetitive.length).toBeGreaterThan(4 * MAX_FRAGMENT_CHARS);
    const res = shareableOrReason({ ...base, csv: repetitive });
    expect(res.ok).toBe(true);
    if (res.ok) expect(decodeShare(res.fragment)!.csv).toBe(repetitive);
  });

  it("refuses a CSV that is oversized even compressed, naming the alternative", () => {
    const res = shareableOrReason({ ...base, csv: incompressibleCsv(1200) });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("too large to fit in a link");
      expect(res.reason).toContain("share the CSV file itself"); // the actionable part
    }
  });

  it("encodeShare itself still encodes oversized state (guard is opt-in)", () => {
    const bigCsv = incompressibleCsv(1200);
    const frag = encodeShare({ ...base, csv: bigCsv });
    expect(frag.length).toBeGreaterThan(MAX_FRAGMENT_CHARS);
    expect(decodeShare(frag)!.csv).toBe(bigCsv); // and it still round-trips
  });
});
