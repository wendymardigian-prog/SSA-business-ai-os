import { describe, expect, it } from "vitest";
import { manualTranscriptWrite, MAX_TRANSCRIPT_CHARS } from "./ad-transcript";

describe("manualTranscriptWrite", () => {
  it("un texto queda lista y manual, sin los espacios de las puntas", () => {
    expect(manualTranscriptWrite("  Hola, soy Wendy.\r\nHoy te cuento...  ")).toEqual({
      ok: true,
      value: { transcript: "Hola, soy Wendy.\nHoy te cuento...", transcript_status: "ready", transcript_source: "manual" },
    });
  });

  it("vacia (o solo espacios) borra la transcripcion: ninguna, sin texto ni fuente", () => {
    const empty = { ok: true, value: { transcript: null, transcript_status: "none", transcript_source: null } };
    expect(manualTranscriptWrite("")).toEqual(empty);
    expect(manualTranscriptWrite("   \n  ")).toEqual(empty);
    expect(manualTranscriptWrite(null)).toEqual(empty);
  });

  it("rechaza lo que no es texto y lo que pasa el tope", () => {
    expect(manualTranscriptWrite(42).ok).toBe(false);
    expect(manualTranscriptWrite("a".repeat(MAX_TRANSCRIPT_CHARS)).ok).toBe(true);
    expect(manualTranscriptWrite("a".repeat(MAX_TRANSCRIPT_CHARS + 1)).ok).toBe(false);
  });
});
