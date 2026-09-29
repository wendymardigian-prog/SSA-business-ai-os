/**
 * Los cuatro estados de la transcripcion (F13).
 */

import { describe, it, expect } from "vitest";
import { emptyAttachment } from "@/lib/messages/attachments";
import { canTranscribe, transcriptView } from "./transcript-state";

const voice = (over = {}) => ({
  v: 2,
  items: [emptyAttachment("voice", { status: "ready", storagePath: "ws-1/cv-1/m-1-0.ogg", ...over })],
});

describe("transcriptView: los cuatro estados (F13)", () => {
  it("ready muestra el texto", () => {
    expect(
      transcriptView({ transcript: "hola, queria el precio", transcript_status: "ready", attachments: voice() }),
    ).toEqual({ state: "ready", text: "hola, queria el precio" });
  });

  it("pending dice que se esta transcribiendo", () => {
    expect(transcriptView({ transcript_status: "pending", attachments: voice() })).toEqual({ state: "pending" });
  });

  it("failed dice el motivo y ofrece reintentar", () => {
    expect(
      transcriptView({
        transcript_status: "failed",
        transcript_error: "El servicio de transcripción rechazó la clave.",
        attachments: voice(),
      }),
    ).toEqual({
      state: "failed",
      error: "El servicio de transcripción rechazó la clave.",
      canRetry: true,
    });
  });

  it("failed sin motivo igual dice algo: un bloque de error vacio no sirve", () => {
    const view = transcriptView({ transcript_status: "failed", attachments: voice() });
    expect(view.state).toBe("failed");
    expect(view.state === "failed" && view.error.length).toBeGreaterThan(0);
  });

  it("none ofrece transcribir", () => {
    expect(transcriptView({ transcript_status: "none", attachments: voice() })).toEqual({ state: "none" });
    expect(transcriptView({ attachments: voice() })).toEqual({ state: "none" });
  });

  it("ready SIN texto cae en none: el estado decia una cosa y la columna otra", () => {
    expect(transcriptView({ transcript: "   ", transcript_status: "ready", attachments: voice() })).toEqual({
      state: "none",
    });
  });
});

describe("transcriptView: cuando no se muestra nada (F13)", () => {
  it("un mensaje de texto no ofrece transcribir nada", () => {
    // Su transcript_status es 'none' igual que una nota de voz sin transcribir:
    // por eso la decision se toma por el ADJUNTO.
    expect(transcriptView({ transcript_status: "none", attachments: null })).toEqual({ state: "hidden" });
  });

  it("una foto o un documento tampoco", () => {
    for (const kind of ["image", "document", "video"] as const) {
      const attachments = { v: 2, items: [emptyAttachment(kind, { status: "ready", storagePath: "p" })] };
      expect(transcriptView({ transcript_status: "none", attachments }).state, kind).toBe("hidden");
    }
  });

  it("sin mensaje no lanza", () => {
    expect(transcriptView(null)).toEqual({ state: "hidden" });
    expect(transcriptView(undefined)).toEqual({ state: "hidden" });
  });

  it("un audio adjunto (no nota de voz) SI se transcribe", () => {
    const attachments = { v: 2, items: [emptyAttachment("audio", { status: "ready", storagePath: "p" })] };
    expect(transcriptView({ transcript_status: "none", attachments }).state).toBe("none");
  });
});

describe("canTranscribe (F13)", () => {
  it("hace falta que el archivo este", () => {
    expect(canTranscribe({ attachments: voice() })).toBe(true);
  });

  it("uno que no se pudo bajar no se puede transcribir: el boton fallaria siempre", () => {
    expect(canTranscribe({ attachments: voice({ status: "failed", storagePath: null }) })).toBe(false);
  });

  it("uno purgado por retencion tampoco", () => {
    expect(canTranscribe({ attachments: voice({ status: "none", storagePath: null }) })).toBe(false);
  });

  it("uno que todavia se esta bajando tampoco", () => {
    expect(canTranscribe({ attachments: voice({ status: "pending", storagePath: null }) })).toBe(false);
  });

  it("un mensaje sin audio, no", () => {
    expect(canTranscribe({ attachments: null })).toBe(false);
    expect(canTranscribe(null)).toBe(false);
  });
});
