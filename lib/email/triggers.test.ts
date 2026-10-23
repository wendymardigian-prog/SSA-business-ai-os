/**
 * El trigger "email recibido" en los flows (F67).
 */

import { describe, it, expect } from "vitest";
import { emailMatches, EMAIL_TRIGGER } from "./triggers";

describe("si el correo dispara el flow (F67)", () => {
  it("sin filtro, cualquier asunto", () => {
    expect(emailMatches({}, { subject: "Consulta" })).toBe(true);
    expect(emailMatches({ subjectContains: null }, { subject: null })).toBe(true);
  });

  it("con filtro, solo los que lo contienen", () => {
    // Sin el filtro, el flow correria con cada correo que entre, incluidos
    // los que no tienen nada que ver.
    expect(emailMatches({ subjectContains: "presupuesto" }, { subject: "Pido presupuesto" })).toBe(true);
    expect(emailMatches({ subjectContains: "presupuesto" }, { subject: "Consulta" })).toBe(false);
  });

  it("el filtro no distingue mayusculas", () => {
    expect(emailMatches({ subjectContains: "PRESUPUESTO" }, { subject: "pido presupuesto" })).toBe(true);
  });

  it("un correo sin asunto no matchea un filtro con texto", () => {
    expect(emailMatches({ subjectContains: "algo" }, { subject: null })).toBe(false);
  });

  it("un filtro de solo espacios cuenta como sin filtro", () => {
    expect(emailMatches({ subjectContains: "   " }, { subject: "Cualquier cosa" })).toBe(true);
  });

  it("el tipo del trigger es el que acepta el CHECK de la base", () => {
    expect(EMAIL_TRIGGER).toBe("email_received");
  });
});

describe("arrancar los flujos (auditoria de automatizaciones)", () => {
  const base = (over: { dnc?: boolean; paused?: boolean } = {}) =>
    ({
      contacts: [{ id: "c1", do_not_contact: over.dnc ?? false }],
      conversations: [{ id: "cv1", is_automation_paused: over.paused ?? false }],
      triggers: [{ id: "t1", flow_id: "f1", config: {}, workspace_id: "ws", type: "email_received", is_active: true }],
      trigger_fires: [],
      flows: [],
      flow_sessions: [],
      analytics_events: [],
    }) as Record<string, Record<string, unknown>[]>;
  const params = { channel: { id: "ch", workspace_id: "ws", late_account_id: "email:a@b.com" } as never, contactId: "c1", conversationId: "cv1", subject: "Hola", text: "hola", emailId: "em-1" };

  it("«no contactar» o una conversacion tomada a mano no arrancan nada", async () => {
    const { memoryDb } = await import("@/lib/agent/testing/memory-db");
    const { runEmailTriggers } = await import("./triggers");
    expect(await runEmailTriggers(memoryDb(base({ dnc: true })).client, params)).toBe(0);
    expect(await runEmailTriggers(memoryDb(base({ paused: true })).client, params)).toBe(0);
  });

  it("el mismo correo no dispara dos veces el mismo flujo", async () => {
    const { memoryDb } = await import("@/lib/agent/testing/memory-db");
    const { runEmailTriggers } = await import("./triggers");
    const db = memoryDb(base(), { unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } });
    await runEmailTriggers(db.client, params);
    await runEmailTriggers(db.client, params);
    expect(db.rows("trigger_fires")).toHaveLength(1);
  });
});
