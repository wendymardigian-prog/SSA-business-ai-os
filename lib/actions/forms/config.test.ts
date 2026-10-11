import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), sign: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/forms/signed-link", () => ({ signFormLink: mocks.sign }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://app.ejemplo.test" }));

import { createSignedFormLink, saveContractConfig, saveSurveyConfig } from "./config";
import { newField } from "@/lib/forms/fields";

const FORM = "11111111-1111-4111-8111-111111111111";
const CONTACT = "33333333-3333-4333-8333-333333333333";

function setup(form: Record<string, unknown> | null, contactVisible = true): { service: FakeDb } {
  const service = fakeDb({
    "forms:select": { data: form === null ? null : { id: FORM, name: "F", type: "survey", status: "draft", slug: "como-vas", draft_definition: { fields: [{ ...newField("nps", "nps", "NPS"), required: true }] }, survey_config: null, contract_config: null, ...form } },
    "forms:update": { data: null },
  });
  const user = fakeDb({ "contacts:select": { data: contactVisible ? { id: CONTACT } : null } });
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: user.client });
  mocks.service.mockResolvedValue(service.client);
  return { service };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sign.mockResolvedValue("https://app.ejemplo.test/f/como-vas?c=tok");
});

describe("saveSurveyConfig", () => {
  const config = { scoreFieldKey: "nps", category: "servicio", oncePerContact: true };
  it("guarda la configuración válida y deja el historial", async () => {
    const { service } = setup({});
    expect(await saveSurveyConfig({ formId: FORM, config })).toEqual({ ok: true });
    expect(service.writesTo("forms")[0].values).toMatchObject({ survey_config: config, updated_by: "u1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "form", action: "form.updated" }));
  });
  it("rechaza un puntaje que no existe o no es obligatorio", async () => {
    const { service } = setup({});
    expect((await saveSurveyConfig({ formId: FORM, config: { ...config, scoreFieldKey: "otro" } })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
    setup({ draft_definition: { fields: [{ ...newField("nps", "nps", "NPS"), required: false }] } });
    expect((await saveSurveyConfig({ formId: FORM, config })).ok).toBe(false);
  });
  it("solo para encuestas y no en un formulario archivado", async () => {
    setup({ type: "custom" });
    expect((await saveSurveyConfig({ formId: FORM, config })).ok).toBe(false);
    setup({ status: "archived" });
    expect((await saveSurveyConfig({ formId: FORM, config })).ok).toBe(false);
  });
  it("sin permiso no hace nada", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await saveSurveyConfig({ formId: FORM, config })).ok).toBe(false);
  });
});

describe("saveContractConfig", () => {
  const config = { title: "Acuerdo", signatureRequired: true, acceptLabel: "Acepto", ccEmails: ["A@x.com"] };
  it("guarda la configuración con las copias en minúsculas", async () => {
    const { service } = setup({ type: "contract" });
    expect(await saveContractConfig({ formId: FORM, config })).toEqual({ ok: true });
    expect(service.writesTo("forms")[0].values).toMatchObject({ contract_config: { ...config, ccEmails: ["a@x.com"] } });
  });
  it("rechaza más de 3 copias o una dirección rota", async () => {
    const { service } = setup({ type: "contract" });
    expect((await saveContractConfig({ formId: FORM, config: { ...config, ccEmails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"] } })).ok).toBe(false);
    expect((await saveContractConfig({ formId: FORM, config: { ...config, ccEmails: ["roto"] } })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });
  it("solo para contratos", async () => {
    setup({ type: "custom" });
    expect((await saveContractConfig({ formId: FORM, config })).ok).toBe(false);
  });
});

describe("createSignedFormLink", () => {
  it("arma el link firmado de un formulario publicado para un contacto que la persona ve", async () => {
    setup({ status: "published" });
    expect(await createSignedFormLink({ formId: FORM, contactId: CONTACT })).toEqual({ ok: true, url: "https://app.ejemplo.test/f/como-vas?c=tok" });
    expect(mocks.sign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspaceId: "ws1", formId: FORM, slug: "como-vas", contactId: CONTACT, baseUrl: "https://app.ejemplo.test" }));
  });
  it("un formulario sin publicar no tiene links", async () => {
    setup({ status: "draft" });
    expect((await createSignedFormLink({ formId: FORM, contactId: CONTACT })).ok).toBe(false);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("un contacto que la persona no ve (o no existe) no recibe link", async () => {
    setup({ status: "published" }, false);
    expect((await createSignedFormLink({ formId: FORM, contactId: CONTACT })).ok).toBe(false);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("si firmar falla, lo explica sin detalles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup({ status: "published" });
    mocks.sign.mockRejectedValue(new Error("vault caido"));
    expect(await createSignedFormLink({ formId: FORM, contactId: CONTACT })).toEqual({ ok: false, error: expect.not.stringContaining("vault") });
  });
});
