import { describe, expect, it } from "vitest";
import { knowledgeSummary, pieceLine, pieceProgress } from "../../src/components/mercbot/useBotKnowledge.js";

// A bot's Knowledge section (D-107): each piece's line and progress, and the summary of what's in mind, searched and
// added to each message, as the server answered them.
const piece = (extra) => ({ state: "ready", mode: "searched", chars: 520000, partsDone: 0, partsTotal: 0, problem: null, ...extra });

describe("a piece's line", () => {
  it("says where it's got to, what's wrong, or its size and mode", () => {
    expect(pieceLine(piece({ state: "reading", mode: null, chars: 0 }))).toBe("Reading the file…");
    expect(pieceLine(piece({ state: "indexing", partsDone: 400, partsTotal: 1000 }))).toBe("520,000 characters · Getting it ready: 400 of 1,000 parts");
    expect(pieceLine(piece({ state: "indexing" }))).toBe("520,000 characters · Getting it ready…");
    expect(pieceLine(piece({}))).toBe("520,000 characters · Searched first");
    expect(pieceLine(piece({ mode: "mind", chars: 1240, state: "indexing" }))).toBe("1,240 characters · Always in mind");
    const problem = "This file has no text Mercbot can read: it may be a scanned picture. Paste its text instead.";
    expect(pieceLine(piece({ state: "failed", mode: null, problem }))).toBe(problem);
  });

  it("shows a bar while a file is read or a long piece got ready, how far when it can tell", () => {
    expect(pieceProgress(piece({ state: "reading", mode: null }))).toEqual({ shown: true, value: null });
    expect(pieceProgress(piece({ state: "indexing", partsDone: 250, partsTotal: 1000 }))).toEqual({ shown: true, value: 25 });
    expect(pieceProgress(piece({ state: "indexing" }))).toEqual({ shown: true, value: null });
    expect(pieceProgress(piece({ state: "indexing", mode: "mind" })).shown).toBe(false);
    expect(pieceProgress(piece({})).shown).toBe(false);
    expect(pieceProgress(piece({ state: "failed" })).shown).toBe(false);
  });
});

describe("the summary", () => {
  it("is nothing for a bot that knows nothing", () => {
    expect(knowledgeSummary(null)).toBeNull();
    expect(knowledgeSummary({ totals: { chars: 0, inMindChars: 0, searchedChars: 0 }, perMessage: { tokens: 0, nano: 0, cachedNano: 0 } })).toBeNull();
  });

  it("says what's in mind, what's searched and what it adds to each message", () => {
    const summary = knowledgeSummary({
      totals: { chars: 532400, inMindChars: 12400, searchedChars: 520000 },
      perMessage: { tokens: 5600, nano: 1_680_000, cachedNano: 768_600 }
    });
    expect(summary.inMind).toBe("Always in mind: 12,400 characters, read with every message.");
    expect(summary.searched).toBe("Searched first: 520,000 characters. Each message reads only the parts that match.");
    expect(summary.cost).toBe("Adds about $0.0017 to each message, or about $0.0008 while it's still cached from a recent one.");
  });

  it("says a cost too small to show is less than $0.0001", () => {
    const of = (nano, cachedNano) => knowledgeSummary({ totals: { chars: 40000, inMindChars: 40000, searchedChars: 0 }, perMessage: { tokens: 10000, nano, cachedNano } });
    expect(of(3_000_000, 60_000).cost).toBe("Adds about $0.003 to each message, or less than $0.0001 while it's still cached from a recent one.");
    expect(of(4_500, 90).cost).toBe("Adds less than $0.0001 to each message.");
    expect(of(4_500, 90).searched).toBe("");
  });

  it("says the cost once when it reads the same while cached, as with a little in mind beside a long search", () => {
    const summary = knowledgeSummary({
      totals: { chars: 65184, inMindChars: 28, searchedChars: 65156 },
      perMessage: { tokens: 2560, nano: 770_000, cachedNano: 760_000 }
    });
    expect(summary.cost).toBe("Adds about $0.0008 to each message.");
  });
});
