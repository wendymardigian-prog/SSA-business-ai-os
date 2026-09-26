/**
 * Procesar un correo que entra (F63).
 *
 * El caso que mas importa de este archivo: **el agente no se agenda nunca**.
 * Hay un espia que lo verifica, porque es la clase de cosa que alguien
 * agrega "por consistencia" con los otros dos receptores.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { maybeScheduleAgentTurn, upsertContactForSender } = vi.hoisted(() => ({
  maybeScheduleAgentTurn: vi.fn(),
  upsertContactForSender: vi.fn(),
}));

vi.mock("@/lib/agent/dispatch", () => ({ maybeScheduleAgentTurn }));
vi.mock("@/lib/inbox-sync", () => ({ upsertContactForSender }));

import { memoryDb } from "@/lib/agent/testing/memory-db";
import type { ChannelRow } from "@/lib/inbound";
import { bodyText, displayName, processInboundEmail, safeName, storeAttachments, type InboundEmail } from "./inbound";

const WS = "ws-1";

const channel = {
  id: "ch-1",
  workspace_id: WS,
  platform: "email",
  provider: "resend",
  email_address: "hola@x.com",
  late_account_id: "email:hola@x.com",
  is_active: true,
} as unknown as ChannelRow;

const email = (over: Partial<InboundEmail> = {}): InboundEmail => ({
  emailId: "re_1",
  from: "Ana Perez <ana@clienta.com>",
  to: ["hola@x.com"],
  subject: "Consulta por el servicio",
  text: "Hola, queria saber el precio.",
  html: null,
  messageId: "<in-1@clienta.com>",
  inReplyTo: null,
  references: null,
  receivedAt: "2026-10-01T12:00:00Z",
  ...over,
});

function db() {
  const memory = memoryDb({
    contacts: [],
    conversations: [],
    messages: [],
    channels: [channel as unknown as Record<string, unknown>],
  });
  // El Storage no lo cubre memoryDb: se simula lo justo.
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({ upload: vi.fn(async () => ({ error: null })) }),
  };
  return memory;
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertContactForSender.mockResolvedValue({ contactId: "ct-1", existed: false });
});

describe("el texto que se muestra (F63)", () => {
  it("el texto plano gana", () => {
    expect(bodyText({ text: "Hola", html: "<p>Otra cosa</p>" })).toBe("Hola");
  });

  it("sin texto plano, el HTML se desarma", () => {
    // Un correo solo en HTML mostrado crudo es una pared de etiquetas.
    expect(bodyText({ text: null, html: "<p>Hola</p><p>Como va</p>" })).toBe("Hola\n\nComo va");
  });

  it("los estilos y los scripts no entran", () => {
    expect(bodyText({ text: null, html: "<style>p{color:red}</style><p>Hola</p>" })).toBe("Hola");
  });

  it("sin nada, cadena vacia y no undefined", () => {
    expect(bodyText({ text: null, html: null })).toBe("");
  });
});

describe("el nombre del remitente (F63)", () => {
  it("se saca del formato con corchetes", () => {
    expect(displayName("Ana Perez <ana@x.com>")).toBe("Ana Perez");
    expect(displayName('"Ana Perez" <ana@x.com>')).toBe("Ana Perez");
  });

  it("sin nombre, null", () => {
    expect(displayName("ana@x.com")).toBeNull();
    expect(displayName(null)).toBeNull();
  });
});

describe("el nombre del archivo adjunto (F63)", () => {
  it("se limpia para que no rompa un path", () => {
    expect(safeName("Presupuesto Año 2026/final.pdf")).toBe("Presupuesto_Ano_2026_final.pdf");
  });

  it("se recorta si es larguisimo", () => {
    expect(safeName("a".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});

describe("copiar los adjuntos (F63)", () => {
  it("se guardan con el workspace como primer segmento", async () => {
    // Es lo que mira la policy del bucket para decidir quien los lee.
    const upload = vi.fn(async () => ({ error: null }));
    const memory = db();
    (memory.client as unknown as { storage: unknown }).storage = { from: () => ({ upload }) };

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(10),
    })) as unknown as typeof fetch;

    const stored = await storeAttachments(memory.client, {
      workspaceId: WS,
      emailId: "re_1",
      attachments: [{ filename: "guia.pdf", contentType: "application/pdf", url: "https://r/1" }],
      fetchImpl,
    });

    expect(stored[0].storagePath).toMatch(/^ws-1\/re_1\/0-guia\.pdf$/);
  });

  it("uno que falla no hace perder el correo entero", async () => {
    const memory = db();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;

    const stored = await storeAttachments(memory.client, {
      workspaceId: WS,
      emailId: "re_1",
      attachments: [{ filename: "roto.pdf", contentType: "application/pdf", url: "https://r/1" }],
      fetchImpl,
    });

    expect(stored).toEqual([]);
  });
});

describe("procesar el correo (F63)", () => {
  it("guarda contacto, conversacion y mensaje con sus cabeceras", async () => {
    const memory = db();

    const result = await processInboundEmail(memory.client, { channel, email: email() });

    expect(result).toMatchObject({ stored: true, automatic: false, contactId: "ct-1" });
    expect(memory.rows("messages")[0]).toMatchObject({
      direction: "inbound",
      email_subject: "Consulta por el servicio",
      email_message_id: "<in-1@clienta.com>",
      email_from: "Ana Perez <ana@clienta.com>",
    });
  });

  it("el email se pasa como clave de deduplicacion del contacto", async () => {
    // Si esta persona ya escribio por Instagram y alguien le cargo el mail,
    // se vincula al mismo contacto.
    await processInboundEmail(db().client, { channel, email: email() });

    expect(upsertContactForSender).toHaveBeenCalledWith(
      expect.objectContaining({ senderEmail: "ana@clienta.com" }),
    );
  });

  it("NUNCA agenda un turno del agente", async () => {
    // El agente esta hecho para chat: un email contestado como un DM se lee
    // mal, y ademas nadie lo pidio.
    await processInboundEmail(db().client, { channel, email: email() });

    expect(maybeScheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("un correo automatico no crea contacto ni conversacion", async () => {
    // Un rebote es informacion util; tratarlo como un lead es crear una
    // persona que no existe.
    const memory = db();

    const result = await processInboundEmail(memory.client, {
      channel,
      email: email({ from: "mailer-daemon@google.com" }),
    });

    expect(result).toMatchObject({ stored: false, automatic: true });
    expect(upsertContactForSender).not.toHaveBeenCalled();
    expect(memory.rows("conversations")).toHaveLength(0);
  });

  it("un correo sin remitente utilizable no se procesa", async () => {
    const result = await processInboundEmail(db().client, {
      channel,
      email: email({ from: "" }),
    });

    expect(result).toMatchObject({ stored: false });
    expect(result.note).toContain("remitente");
  });

  it("si no se puede resolver el contacto, no se guarda a medias", async () => {
    upsertContactForSender.mockResolvedValueOnce(null);
    const memory = db();

    const result = await processInboundEmail(memory.client, { channel, email: email() });

    expect(result.stored).toBe(false);
    expect(memory.rows("messages")).toHaveLength(0);
  });
});
