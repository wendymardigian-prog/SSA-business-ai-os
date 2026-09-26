/**
 * Armar una respuesta de email (F65).
 */

import { describe, it, expect } from "vitest";
import {
  bareAddress,
  buildReferences,
  canReply,
  MAX_REFERENCES,
  replyHeaders,
  replySubject,
  textToHtml,
} from "./reply";

describe("el asunto (F65)", () => {
  it("le pone Re: una sola vez", () => {
    // "Re: Re: Re: Consulta" es lo que pasa cuando cada sistema agrega el suyo.
    expect(replySubject("Consulta")).toBe("Re: Consulta");
    expect(replySubject("Re: Consulta")).toBe("Re: Consulta");
    expect(replySubject("RE: Consulta")).toBe("Re: Consulta");
    expect(replySubject("Re[2]: Consulta")).toBe("Re: Consulta");
  });

  it("reconoce las formas de otros idiomas", () => {
    // Un hilo puede empezar en el cliente de la otra persona.
    expect(replySubject("Antw: Anfrage")).toBe("Re: Anfrage");
    expect(replySubject("Sv: Spørsmål")).toBe("Re: Spørsmål");
  });

  it("sin asunto, lo dice en vez de mandar uno vacio", () => {
    expect(replySubject(null)).toBe("Re: (sin asunto)");
    expect(replySubject("   ")).toBe("Re: (sin asunto)");
  });
});

describe("la cadena References (F65)", () => {
  it("es la anterior mas el mensaje al que se responde", () => {
    expect(buildReferences({ previousReferences: "<a> <b>", inReplyTo: "<c>" })).toBe("<a> <b> <c>");
  });

  it("sin nada anterior, es solo ese", () => {
    expect(buildReferences({ previousReferences: null, inReplyTo: "<c>" })).toBe("<c>");
  });

  it("no repite", () => {
    expect(buildReferences({ previousReferences: "<a> <b>", inReplyTo: "<b>" })).toBe("<a> <b>");
  });

  it("cuando crece, conserva el primero y los ultimos", () => {
    // El primero abre el hilo; los ultimos son con los que el cliente lo arma.
    const many = Array.from({ length: 40 }, (_, i) => `<m${i}>`).join(" ");
    const result = buildReferences({ previousReferences: many, inReplyTo: "<nuevo>" });
    const ids = (result ?? "").split(" ");

    expect(ids).toHaveLength(MAX_REFERENCES);
    expect(ids[0]).toBe("<m0>");
    expect(ids.at(-1)).toBe("<nuevo>");
  });

  it("sin nada, null y no una cadena vacia", () => {
    expect(buildReferences({ previousReferences: null, inReplyTo: null })).toBeNull();
  });
});

describe("las tres cabeceras juntas (F65)", () => {
  it("salen del ultimo entrante", () => {
    expect(
      replyHeaders({ subject: "Consulta", messageId: "<in-1>", references: "<abre>" }),
    ).toEqual({
      subject: "Re: Consulta",
      inReplyTo: "<in-1>",
      references: "<abre> <in-1>",
    });
  });
});

describe("el cuerpo en HTML (F65)", () => {
  it("respeta los saltos de linea", () => {
    expect(textToHtml("Hola\nComo va")).toContain("Hola<br>Como va");
  });

  it("separa los parrafos", () => {
    const html = textToHtml("Primero\n\nSegundo");

    expect(html).toContain("<p>Primero</p>");
    expect(html).toContain("<p>Segundo</p>");
  });

  it("escapa lo que romperia el HTML", () => {
    expect(textToHtml('<script>alert("x")</script>')).not.toContain("<script>");
  });
});

describe("si se puede responder (F65)", () => {
  const base = {
    channelPlatform: "email",
    channelActive: true,
    contactOptedOut: false,
    toAddress: "ana@clienta.com",
  };

  it("con todo en orden, si", () => {
    expect(canReply(base)).toEqual({ ok: true });
  });

  it("a un contacto que pidio que no le escriban, no", () => {
    // Es exactamente lo que la marca existe para evitar.
    const result = canReply({ ...base, contactOptedOut: true });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("no le escriban");
  });

  it("con el canal desconectado, no", () => {
    expect(canReply({ ...base, channelActive: false }).ok).toBe(false);
  });

  it("sin direccion, no", () => {
    expect(canReply({ ...base, toAddress: null }).ok).toBe(false);
  });

  it("una conversacion que no es de email, no", () => {
    expect(canReply({ ...base, channelPlatform: "instagram" }).ok).toBe(false);
  });
});

describe("la direccion sola (F65)", () => {
  it("se saca el nombre", () => {
    expect(bareAddress("Ana Perez <ana@clienta.com>")).toBe("ana@clienta.com");
    expect(bareAddress("ana@clienta.com")).toBe("ana@clienta.com");
  });

  it("se normaliza a minusculas", () => {
    expect(bareAddress("Ana@Clienta.COM")).toBe("ana@clienta.com");
  });

  it("lo que no es una direccion da null", () => {
    expect(bareAddress("Ana Perez")).toBeNull();
    expect(bareAddress(null)).toBeNull();
  });
});
