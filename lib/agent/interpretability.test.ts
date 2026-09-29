/**
 * La compuerta de interpretabilidad (F10): el arreglo urgente.
 *
 * Lo que decide: si el agente responde, si el turno se reagenda, o si la
 * conversacion pasa a una persona.
 */

import { describe, it, expect } from "vitest";
import { emptyAttachment } from "@/lib/messages/attachments";
import { assessInterpretability, WAIT_FOR_MEDIA_MS, type InterpretabilityInput } from "./interpretability";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

const items = (...kinds: Parameters<typeof emptyAttachment>[0][]) => ({
  v: 2,
  items: kinds.map((kind) => emptyAttachment(kind, { status: "ready", storagePath: "p" })),
});

const msg = (over: Partial<InterpretabilityInput> = {}): InterpretabilityInput => ({
  created_at: secondsAgo(5),
  ...over,
});

const assess = (messages: InterpretabilityInput[]) => assessInterpretability(messages, { now: NOW });

describe("assessInterpretability: cuando el agente puede responder (F10)", () => {
  it("una rafaga de texto es interpretable", () => {
    expect(assess([msg({ text: "hola" }), msg({ text: "queria el precio" })])).toEqual({
      interpretable: true,
      reason: null,
      waiting: false,
    });
  });

  it("una nota de voz YA transcripta es interpretable", () => {
    expect(
      assess([
        msg({ transcript: "hola, queria el precio", transcript_status: "ready", attachments: items("voice") }),
      ]),
    ).toMatchObject({ interpretable: true });
  });

  it("una imagen YA descripta es interpretable", () => {
    expect(assess([msg({ media_description: "Una captura del comprobante", attachments: items("image") })])).toMatchObject(
      { interpretable: true },
    );
  });

  it("una foto CON caption es interpretable aunque no este descripta: el caption alcanza", () => {
    expect(assess([msg({ text: "mirá el comprobante", attachments: items("image") })])).toMatchObject({
      interpretable: true,
    });
  });

  it("una rafaga vacia es interpretable: no hay nada que no se entienda", () => {
    expect(assess([])).toMatchObject({ interpretable: true });
  });
});

describe("assessInterpretability: cuando vale ESPERAR (F10)", () => {
  it("un audio transcribiendose hace menos de 90 s: se reagenda, no se escala", () => {
    const verdict = assess([
      msg({ transcript_status: "pending", attachments: items("voice"), created_at: secondsAgo(10) }),
    ]);

    expect(verdict).toEqual({ interpretable: false, reason: null, waiting: true });
  });

  it("un audio que todavia no arranco tambien se espera", () => {
    expect(
      assess([msg({ transcript_status: "none", attachments: items("voice"), created_at: secondsAgo(3) })]),
    ).toMatchObject({ waiting: true });
  });

  it("una imagen sin describir se espera igual: el job puede estar corriendo", () => {
    expect(assess([msg({ attachments: items("image"), created_at: secondsAgo(10) })])).toMatchObject({
      waiting: true,
    });
  });

  it("pasados los 90 s ya NO se espera: escala", () => {
    const verdict = assess([
      msg({ transcript_status: "pending", attachments: items("voice"), created_at: secondsAgo(91) }),
    ]);

    expect(verdict.waiting).toBe(false);
    expect(verdict.interpretable).toBe(false);
    expect(verdict.reason).toContain("no terminó a tiempo");
  });

  it("justo en el limite de los 90 s tampoco se espera mas", () => {
    expect(
      assess([msg({ transcript_status: "pending", attachments: items("voice"), created_at: secondsAgo(90) })]),
    ).toMatchObject({ waiting: false, interpretable: false });
  });

  it("si en la misma rafaga hay algo DEFINITIVAMENTE ilegible, no se espera: escala ya", () => {
    // Esperar la transcripcion no sirve de nada si igual hay un video que el
    // agente no va a poder ver nunca.
    const verdict = assess([
      msg({ transcript_status: "pending", attachments: items("voice"), created_at: secondsAgo(5) }),
      msg({ attachments: items("video"), created_at: secondsAgo(5) }),
    ]);

    expect(verdict).toMatchObject({ interpretable: false, waiting: false });
    expect(verdict.reason).toContain("video");
  });

  it("la ventana se puede ajustar sin rediseñar nada: es una constante", () => {
    expect(WAIT_FOR_MEDIA_MS).toBe(90_000);

    const verdict = assessInterpretability(
      [msg({ transcript_status: "pending", attachments: items("voice"), created_at: secondsAgo(10) })],
      { now: NOW, waitMs: 5_000 },
    );
    expect(verdict.waiting).toBe(false);
  });
});

describe("assessInterpretability: cuando hay que escalar (F10)", () => {
  it("un audio que no se pudo transcribir escala, con el motivo en castellano", () => {
    const verdict = assess([msg({ transcript_status: "failed", attachments: items("voice") })]);

    expect(verdict).toEqual({
      interpretable: false,
      reason: "Llegó una nota de voz que no se pudo transcribir",
      waiting: false,
    });
  });

  it("un video, un documento, una ubicacion, un contacto y una encuesta escalan", () => {
    for (const [kind, fragment] of [
      ["video", "video"],
      ["document", "documento"],
      ["location", "ubicación"],
      ["contact", "contacto"],
      ["poll", "encuesta"],
    ] as const) {
      const verdict = assess([msg({ attachments: items(kind) })]);
      expect(verdict.interpretable, kind).toBe(false);
      expect(verdict.waiting, kind).toBe(false);
      expect(verdict.reason, kind).toContain(fragment);
    }
  });

  it("un tipo desconocido escala: ante la duda, una persona", () => {
    expect(assess([msg({ attachments: items("unsupported") })])).toMatchObject({
      interpretable: false,
      waiting: false,
    });
  });

  it("alcanza que UNO de la rafaga no se entienda: responder al resto es contestar a medias", () => {
    const verdict = assess([msg({ text: "hola" }), msg({ attachments: items("video") })]);

    expect(verdict.interpretable).toBe(false);
    expect(verdict.reason).toContain("video");
  });

  it("una fecha ilegible no da una espera infinita: escala", () => {
    expect(
      assess([msg({ transcript_status: "pending", attachments: items("voice"), created_at: "cualquier cosa" })]),
    ).toMatchObject({ interpretable: false, waiting: false });
  });

  it("un mensaje sin texto y sin adjuntos no bloquea la rafaga", () => {
    expect(assess([msg({ text: null }), msg({ text: "hola" })])).toMatchObject({ interpretable: true });
  });
});
