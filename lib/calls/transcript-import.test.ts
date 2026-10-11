import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, normalizeClock, parseTranscriptText, titleFromFilename, transcriptWordCount, validateImportFile, validateImportText } from "./transcript-import";

describe("parseTranscriptText: texto plano", () => {
  it("cada linea no vacia es un parrafo, sin hablante ni tiempo", () => {
    expect(parseTranscriptText("Hola\n\nQue tal")).toEqual([
      { speaker: { display_name: "" }, text: "Hola", timestamp: "" },
      { speaker: { display_name: "" }, text: "Que tal", timestamp: "" },
    ]);
  });

  it("conserva el hablante de `Nombre: texto`", () => {
    const r = parseTranscriptText("Ana Pérez: Hola, ¿cómo estás?\nLeo: Bien");
    expect(r.map((l) => [l.speaker.display_name, l.text])).toEqual([["Ana Pérez", "Hola, ¿cómo estás?"], ["Leo", "Bien"]]);
  });

  it("no toma una URL ni una hora como hablante", () => {
    const r = parseTranscriptText("https://zoom.us/j/123 es el link\n10:30 arrancamos");
    expect(r.every((l) => l.speaker.display_name === "")).toBe(true);
  });

  it("descarta la marca de agua de TurboScribe", () => {
    expect(parseTranscriptText("Transcribed by TurboScribe.ai\nHola")).toHaveLength(1);
  });
});

describe("parseTranscriptText: VTT", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Ana>Hola\n\n00:00:04.500 --> 00:00:06.000\n<v Leo>Buen día</v>\n";

  it("conserva hablante y tiempo de `<v Nombre>texto`", () => {
    const r = parseTranscriptText(vtt);
    expect(r[0]).toEqual({ speaker: { display_name: "Ana" }, text: "Hola", timestamp: "00:00:01" });
    expect(r[1]).toEqual({ speaker: { display_name: "Leo" }, text: "Buen día", timestamp: "00:00:04" });
  });

  it("descarta la cabecera WEBVTT y los NOTE", () => {
    expect(parseTranscriptText("WEBVTT\n\nNOTE esto es un comentario\n\n00:01.000 --> 00:02.000\nHola")).toHaveLength(1);
  });

  it("entiende tiempos sin horas", () => {
    expect(parseTranscriptText("00:05.000 --> 00:07.000\nHola")[0].timestamp).toBe("00:00:05");
  });

  it("un identificador de cue antes de la linea de tiempo no se vuelve texto", () => {
    const r = parseTranscriptText("cue-1\n00:00:02.000 --> 00:00:03.000\nHola");
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("Hola");
  });
});

describe("parseTranscriptText: SRT", () => {
  const srt = "1\n00:00:01,000 --> 00:00:03,000\nAna: Hola\n\n2\n00:00:04,000 --> 00:00:06,000\nQué tal\n";

  it("descarta indices y lineas de tiempo, y conserva el texto con su tiempo", () => {
    const r = parseTranscriptText(srt);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ speaker: { display_name: "Ana" }, text: "Hola", timestamp: "00:00:01" });
    // El hablante solo aparece al cambiar: la segunda linea sigue con Ana.
    expect(r[1]).toEqual({ speaker: { display_name: "Ana" }, text: "Qué tal", timestamp: "00:00:04" });
  });

  it("acepta saltos de linea de Windows", () => {
    expect(parseTranscriptText(srt.replace(/\n/g, "\r\n"))).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("normalizeClock", () => {
    expect(normalizeClock("1:05")).toBe("00:01:05");
    expect(normalizeClock("01:02:03")).toBe("01:02:03");
  });
  it("transcriptWordCount y titleFromFilename", () => {
    expect(transcriptWordCount([{ text: "uno dos tres" }, { text: "" }])).toBe(3);
    expect(titleFromFilename("llamada_con-ana.vtt")).toBe("Llamada Con Ana");
    expect(titleFromFilename(".vtt")).toBe("Llamada importada");
  });
});

describe("validacion de la importacion", () => {
  it("rechaza un archivo de 3 MB", () => {
    expect(validateImportFile({ name: "x.vtt", size: 3 * 1024 * 1024 }).ok).toBe(false);
    expect(validateImportFile({ name: "x.vtt", size: MAX_IMPORT_BYTES }).ok).toBe(true);
  });
  it("rechaza una extension que no es .vtt, .srt o .txt", () => {
    expect(validateImportFile({ name: "x.pdf", size: 10 }).ok).toBe(false);
    expect(validateImportFile({ name: "X.SRT", size: 10 }).ok).toBe(true);
  });
  it("rechaza texto vacio o de mas de 2 MB", () => {
    expect(validateImportText("  ").ok).toBe(false);
    expect(validateImportText("a".repeat(MAX_IMPORT_BYTES + 1)).ok).toBe(false);
    expect(validateImportText("hola").ok).toBe(true);
  });
});
