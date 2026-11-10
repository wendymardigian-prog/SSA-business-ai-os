import { describe, it, expect, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { isAlreadyAnswered, loadLinkPrefill } from "./public-load";

const form = (over: Record<string, unknown> = {}) => ({ id: "form1", workspace_id: "ws1", type: "survey", status: "published", survey_config: { oncePerContact: true }, ...over });

function setup(over: { form?: Record<string, unknown> | null; existing?: boolean; verify?: ReturnType<typeof vi.fn> } = {}) {
  const db = fakeDb({
    "forms:select": { data: over.form === null ? null : form(over.form ?? {}) },
    "form_submissions:select": { data: over.existing === false ? null : { id: "sub1" } },
  });
  const verify = over.verify ?? vi.fn(async () => ({ ok: true as const, contactId: "contact1", serviceId: null, saleId: null }));
  return { db, verify };
}

describe("isAlreadyAnswered", () => {
  it("con un link válido de quien ya respondió: sí", async () => {
    const { db, verify } = setup();
    expect(await isAlreadyAnswered(db.client, "como-vas", "tok", verify as never)).toBe(true);
    expect(verify).toHaveBeenCalledWith(db.client, "tok", { workspaceId: "ws1", formId: "form1" });
    const filters = db.calls.find((c) => c.table === "form_submissions")!.filters;
    expect(filters).toContainEqual({ method: "eq", column: "once_key", value: "contact:contact1" });
    expect(filters).toContainEqual({ method: "neq", column: "status", value: "spam" });
  });

  it("si no respondió todavía: no", async () => {
    const { db, verify } = setup({ existing: false });
    expect(await isAlreadyAnswered(db.client, "como-vas", "tok", verify as never)).toBe(false);
  });

  it("un token inválido o vencido se ignora (no da error)", async () => {
    const { db } = setup({ verify: vi.fn(async () => ({ ok: false as const, reason: "signature" as const })) });
    expect(await isAlreadyAnswered(db.client, "como-vas", "roto", undefined as never)).toBe(false);
    const bad = setup({ verify: vi.fn(async () => ({ ok: false as const, reason: "expired" as const })) });
    expect(await isAlreadyAnswered(bad.db.client, "como-vas", "viejo", bad.verify as never)).toBe(false);
  });

  it("sin token, sin consulta", async () => {
    const { db, verify } = setup();
    expect(await isAlreadyAnswered(db.client, "como-vas", undefined, verify as never)).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it("solo aplica a encuestas con 'una vez por contacto'", async () => {
    for (const over of [{ type: "custom" }, { survey_config: { oncePerContact: false } }, { survey_config: null }]) {
      const { db, verify } = setup({ form: over });
      expect(await isAlreadyAnswered(db.client, "como-vas", "tok", verify as never)).toBe(false);
      expect(verify).not.toHaveBeenCalled();
    }
  });

  it("un formulario que no existe o un slug inválido: no", async () => {
    const missing = setup({ form: null });
    expect(await isAlreadyAnswered(missing.db.client, "como-vas", "tok", missing.verify as never)).toBe(false);
    const { db } = setup();
    expect(await isAlreadyAnswered(db.client, "NO VALIDO!", "tok")).toBe(false);
  });
});

describe("loadLinkPrefill", () => {
  const fields = [
    { key: "nombre", type: "short_text" },
    { key: "email", type: "email" },
    { key: "whatsapp", type: "phone" },
  ];
  const contactConfig = { map: [{ fieldKey: "nombre", target: "contact.display_name" }, { fieldKey: "email", target: "contact.email" }, { fieldKey: "whatsapp", target: "contact.phone" }] };
  const open = (over: { form?: Record<string, unknown> | null; contact?: Record<string, unknown> | null; verify?: ReturnType<typeof vi.fn> } = {}) => {
    const db = fakeDb({
      "forms:select": { data: over.form === null ? null : { id: "form1", workspace_id: "ws1", type: "contract", contact_config: contactConfig, ...(over.form ?? {}) } },
      "contacts:select": { data: over.contact === null ? null : { display_name: "Ana Pérez", email: "ana@ejemplo.com", phone: "+50688881234", whatsapp_phone: null, ...(over.contact ?? {}) } },
    });
    const verify = over.verify ?? vi.fn(async () => ({ ok: true as const, contactId: "contact1", serviceId: "svc1", saleId: "sale1" }));
    return { db, verify };
  };

  it("con un link válido devuelve nombre, email y teléfono de la persona", async () => {
    const { db, verify } = open();
    expect(await loadLinkPrefill(db.client, "contrato", "tok", fields, verify as never)).toEqual({ nombre: "Ana Pérez", email: "ana@ejemplo.com", whatsapp: "+50688881234" });
    expect(verify).toHaveBeenCalledWith(db.client, "tok", { workspaceId: "ws1", formId: "form1" });
    const filters = db.calls.find((c) => c.table === "contacts")!.filters;
    expect(filters).toContainEqual({ method: "eq", column: "id", value: "contact1" });
    expect(filters).toContainEqual({ method: "eq", column: "workspace_id", value: "ws1" });
  });

  it("un link roto, vencido o de otro formulario no da nada, y no lee el contacto", async () => {
    const { db } = open({ verify: vi.fn(async () => ({ ok: false as const, reason: "signature" as const })) });
    expect(await loadLinkPrefill(db.client, "contrato", "roto", fields, vi.fn(async () => ({ ok: false as const, reason: "form" as const })) as never)).toEqual({});
    expect(db.calls.some((c) => c.table === "contacts")).toBe(false);
  });

  it("sin token, sin consulta; un reporte de fin de día nunca", async () => {
    const { db, verify } = open();
    expect(await loadLinkPrefill(db.client, "contrato", undefined, fields, verify as never)).toEqual({});
    expect(db.calls).toHaveLength(0);
    const eod = open({ form: { type: "eod" } });
    expect(await loadLinkPrefill(eod.db.client, "contrato", "tok", fields, eod.verify as never)).toEqual({});
    expect(eod.verify).not.toHaveBeenCalled();
  });

  it("un contacto que no existe, o un error, deja el formulario vacío (nunca rompe la página)", async () => {
    const none = open({ contact: null });
    expect(await loadLinkPrefill(none.db.client, "contrato", "tok", fields, none.verify as never)).toEqual({});
    const boom = open({ verify: vi.fn(async () => { throw new Error("falló"); }) });
    expect(await loadLinkPrefill(boom.db.client, "contrato", "tok", fields, boom.verify as never)).toEqual({});
  });
});
