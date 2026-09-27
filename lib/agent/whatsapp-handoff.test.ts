import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyWhatsappMarker, recordWhatsappHandoff, sentTextHasLink } from "./whatsapp-handoff";
import { memoryDb } from "./testing/memory-db";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const LINK = "https://wa.me/50670814873?text=hola";

describe("applyWhatsappMarker", () => {
  it("reemplaza todas las apariciones cuando hubo llamada", () => {
    const r = applyWhatsappMarker(["Escribime acá {{LINK_WHATSAPP}}", "o de nuevo {{LINK_WHATSAPP}}"], LINK);
    expect(r.note).toBeNull();
    expect(r.parts[0]).toContain(LINK);
    expect(r.parts[1]).toContain(LINK);
    expect(r.parts.join(" ")).not.toContain("{{LINK_WHATSAPP}}");
  });

  it("marcador sin llamada: saca el marcador y deja la puntuacion prolija", () => {
    const r = applyWhatsappMarker(["Escribime acá: {{LINK_WHATSAPP}}."], null);
    expect(r.note).toBe("marker_without_tool");
    expect(r.parts.join(" ")).not.toContain("{{LINK_WHATSAPP}}");
    expect(r.parts[0]).toBe("Escribime acá.");
  });

  it("llamada sin marcador: no agrega nada", () => {
    const r = applyWhatsappMarker(["Gracias por tu mensaje"], LINK);
    expect(r.note).toBe("tool_without_marker");
    expect(r.parts[0]).toBe("Gracias por tu mensaje");
    expect(r.parts[0]).not.toContain(LINK);
  });

  it("ni marcador ni llamada: sin cambios", () => {
    const r = applyWhatsappMarker(["Hola"], null);
    expect(r.note).toBeNull();
    expect(r.parts).toEqual(["Hola"]);
  });
});

describe("sentTextHasLink", () => {
  it("mira lo que salio, no lo que se quiso", () => {
    expect(sentTextHasLink([`escribime a ${LINK}`], LINK)).toBe(true);
    expect(sentTextHasLink(["lo saque a mano"], LINK)).toBe(false);
  });
});

describe("recordWhatsappHandoff", () => {
  const base = {
    workspaceId: "ws-1",
    agentId: "agent-1",
    contactId: "c-1",
    conversationId: "cv-1",
    channelId: "ch-1",
    runId: "run-1",
    link: LINK,
    textoPreescrito: "Hola Wendy, soy Ana.",
    origin: "tool" as const,
  };

  it("escribe una entrada whatsapp_handoff cuando el texto lleva el link", async () => {
    const db = memoryDb({ audit_log: [] });
    const id = await recordWhatsappHandoff(db.client, { ...base, sentTexts: [`dale: ${LINK}`], messageId: "m-1" });
    expect(id).not.toBeNull();
    const rows = db.rows("audit_log");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "whatsapp_handoff",
      entity_type: "contact",
      entity_id: "c-1",
      performed_by_agent_id: "agent-1",
    });
    const meta = rows[0].metadata as Record<string, unknown>;
    expect(meta.link).toBe(LINK);
    expect(meta.reason).toBe("Hola Wendy, soy Ana.");
    expect(meta.message_id).toBe("m-1");
    expect(meta.run_id).toBe("run-1");
  });

  it("no escribe nada si el texto enviado no lleva el link", async () => {
    const db = memoryDb({ audit_log: [] });
    const id = await recordWhatsappHandoff(db.client, { ...base, sentTexts: ["lo saque a mano"] });
    expect(id).toBeNull();
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});
