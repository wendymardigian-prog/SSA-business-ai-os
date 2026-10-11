import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  service: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  members: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/workspace-members", () => ({ getWorkspaceMembers: mocks.members }));

import { linkSubmissionToContact, saveContactSettings, searchContactsForForm } from "./contact";
import { newField } from "@/lib/forms/fields";

const FORM = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const TAG = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

const fields = [newField("short_text", "nombre", "Nombre"), newField("email", "email", "Email")];
const config = { mode: "create_or_link" as const, update: "fill_empty" as const, map: [{ fieldKey: "email", target: "contact.email" }] };

function setupSettings(over: { status?: string; tags?: string[] } = {}): { service: FakeDb } {
  const service = fakeDb({
    "forms:select": { data: { id: FORM, status: over.status ?? "draft", draft_definition: { fields }, contact_config: {}, tags_on_submit: [], notify_enabled: true, notify_user_ids: [] } },
    "custom_field_definitions:select": { data: [] },
    "tags:select": { data: (over.tags ?? [TAG]).map((id) => ({ id })) },
    "forms:update": { data: null },
  });
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: fakeDb().client });
  mocks.service.mockResolvedValue(service.client);
  mocks.members.mockResolvedValue([{ userId: USER, name: "Ana" }]);
  return { service };
}

beforeEach(() => vi.clearAllMocks());

describe("saveContactSettings", () => {
  const input = (over = {}) => ({ formId: FORM, contactConfig: config, tagIds: [TAG], notifyEnabled: true, notifyUserIds: [USER], ...over });

  it("sin permiso no hace nada", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await saveContactSettings(input())).ok).toBe(false);
  });

  it("guarda mapeo, etiquetas y avisos", async () => {
    const { service } = setupSettings();
    expect(await saveContactSettings(input())).toEqual({ ok: true });
    expect(service.writesTo("forms")[0].values).toMatchObject({ contact_config: config, tags_on_submit: [TAG], notify_enabled: true, notify_user_ids: [USER], updated_by: "u1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "form", action: "form.updated" }));
  });

  it("un mapeo incompatible o repetido no se guarda", async () => {
    const { service } = setupSettings();
    const out = await saveContactSettings(input({ contactConfig: { ...config, map: [{ fieldKey: "nombre", target: "contact.phone" }, { fieldKey: "nombre", target: "contact.email" }] } }));
    expect(out.ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("una etiqueta de otro workspace (o borrada) no pasa", async () => {
    const { service } = setupSettings({ tags: [] });
    expect((await saveContactSettings(input())).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("los avisos solo van a quienes siguen en el workspace", async () => {
    const { service } = setupSettings();
    await saveContactSettings(input({ notifyUserIds: [USER, "66666666-6666-4666-8666-666666666666"] }));
    expect((service.writesTo("forms")[0].values as { notify_user_ids: string[] }).notify_user_ids).toEqual([USER]);
  });

  it("un formulario archivado no se edita", async () => {
    setupSettings({ status: "archived" });
    expect((await saveContactSettings(input())).ok).toBe(false);
  });
});

describe("searchContactsForForm", () => {
  it("menos de 2 letras no consulta", async () => {
    const user = fakeDb();
    mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: user.client });
    expect(await searchContactsForForm("a")).toEqual([]);
    expect(user.calls).toHaveLength(0);
  });
  it("devuelve nombre y email", async () => {
    const user = fakeDb({ "contacts:select": { data: [{ id: CONTACT, display_name: "Ana Pérez", email: "ana@x.com" }] } });
    mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: user.client });
    expect(await searchContactsForForm("ana")).toEqual([{ id: CONTACT, name: "Ana Pérez", email: "ana@x.com" }]);
  });
});

describe("linkSubmissionToContact", () => {
  function setupLink(over: { submission?: Record<string, unknown> | null; contact?: unknown } = {}) {
    const user = fakeDb({
      "form_submissions:select": { data: over.submission === null ? null : { id: SUB, form_id: FORM, status: "no_contact", contact_id: null, score: 4, nps_category: "detractor", ...(over.submission ?? {}) } },
      "contacts:select": { data: over.contact === undefined ? { id: CONTACT } : over.contact },
    });
    const service = fakeDb({
      "forms:select": { data: { id: FORM, name: "NPS", type: "survey" } },
      "form_submissions:update": { data: null },
      "automation_events:insert": { data: null },
    });
    mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: user.client });
    mocks.service.mockResolvedValue(service.client);
    return { service };
  }

  it("sin tildar la casilla vincula y NO emite evento", async () => {
    const { service } = setupLink();
    expect(await linkSubmissionToContact({ submissionId: SUB, contactId: CONTACT })).toEqual({ ok: true });
    expect(service.writesTo("form_submissions")[0].values).toMatchObject({ contact_id: CONTACT, status: "received", contact_created: false });
    expect(service.writesTo("automation_events")).toHaveLength(0);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "contact", entityId: CONTACT, action: "contact.linked" }));
  });

  it("tildada, emite el evento del tipo con payload de solo escalares y sin booking_id", async () => {
    const { service } = setupLink();
    await linkSubmissionToContact({ submissionId: SUB, contactId: CONTACT, fireAutomations: true });
    const event = service.writesTo("automation_events")[0].values as { event_type: string; contact_id: string; payload: Record<string, unknown> };
    expect(event).toMatchObject({ event_type: "survey_answered", contact_id: CONTACT });
    expect(event.payload).toEqual({ submission_id: SUB, form_id: FORM, form_type: "survey", score: 4, nps_category: "detractor" });
    expect(event.payload).not.toHaveProperty("booking_id");
  });

  it("una respuesta que ya tiene contacto no se pisa", async () => {
    const { service } = setupLink({ submission: { contact_id: CONTACT } });
    expect((await linkSubmissionToContact({ submissionId: SUB, contactId: CONTACT })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("un contacto que no existe o no se ve no se vincula", async () => {
    const { service } = setupLink({ contact: null });
    expect((await linkSubmissionToContact({ submissionId: SUB, contactId: CONTACT })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("una respuesta spam no se vincula", async () => {
    setupLink({ submission: { status: "spam" } });
    expect((await linkSubmissionToContact({ submissionId: SUB, contactId: CONTACT })).ok).toBe(false);
  });
});
