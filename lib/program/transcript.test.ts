// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { chunkTranscript, parseTimedLines, transcriptFormat } from "./transcript";

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hola, bienvenidos a la clase.

2
00:01:05.500 --> 00:01:09.000
<v Ana>Hoy vemos el embudo.

3
01:00:00.000 --> 01:00:02.000
Cierre.`;

const SRT = `1
00:00:02,000 --> 00:00:05,000
Primera línea

2
00:00:10,000 --> 00:00:12,000
Segunda línea`;

describe("la transcripción de una clase", () => {
  it("lee un .vtt con el segundo de cada parte", () => {
    expect(parseTimedLines(VTT)).toEqual([
      { text: "Hola, bienvenidos a la clase.", startSecond: 1 },
      { text: "Hoy vemos el embudo.", startSecond: 65 },
      { text: "Cierre.", startSecond: 3600 },
    ]);
  });
  it("lee un .srt", () => {
    expect(parseTimedLines(SRT).map((l) => l.startSecond)).toEqual([2, 10]);
  });
  it("con texto suelto, sin minutos", () => {
    expect(chunkTranscript("Una idea.\nOtra idea.")).toEqual([{ text: "Una idea. Otra idea.", startSecond: null }]);
  });
  it("junta en fragmentos con el segundo del primero", () => {
    const chunks = chunkTranscript(VTT, 40);
    expect(chunks[0]).toEqual({ text: "Hola, bienvenidos a la clase.", startSecond: 1 });
    expect(chunks[1].startSecond).toBe(65);
  });
  it("reconoce el formato por el nombre", () => {
    expect(transcriptFormat("clase.VTT")).toBe("vtt");
    expect(transcriptFormat("clase.docx")).toBeNull();
  });
});
