import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: mocks.revalidateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { changeFormSlug, publishForm, setFormStatus } from "./forms";
import { newField } from "@/lib/forms/fields";

const FORM = "11111111-1111-4111-8111-111111111111";

function setup(over: Record<string, unknown> = {}) {
  const row = {
    id: FORM, workspace_id: "ws1", name: "Aplicación", type: "custom", status: "published", slug: "aplicacion", current_version_id: "v1",
    draft_definition: { fields: [{ ...newField("short_text", "nombre", "Nombre"), required: true }] }, survey_config: null, contract_config: null, updated_at: "2026-10-11T10:00:00Z", ...over,
  };
  const service = fakeDb({ "forms:select": { data: row }, "forms:update": { data: null } }, { publish_form_version: { data: { version_number: 2, changed: true } } });
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: fakeDb().client, can: () => true });
  mocks.service.mockResolvedValue(service.client);
  return service;
}

beforeEach(() => vi.clearAllMocks());

describe("la caché de las páginas del sitio (F31)", () => {
  it("publicar invalida la etiqueta form:<slug>", async () => {
    setup();
    expect(await publishForm(FORM)).toMatchObject({ ok: true, versionNumber: 2 });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("form:aplicacion", { expire: 0 });
  });

  it("pausar, archivar y reanudar también la invalidan", async () => {
    for (const [from, to] of [["published", "paused"], ["paused", "published"], ["published", "archived"]] as const) {
      mocks.revalidateTag.mockClear();
      setup({ status: from });
      expect((await setFormStatus(FORM, to)).ok).toBe(true);
      expect(mocks.revalidateTag).toHaveBeenCalledWith("form:aplicacion", { expire: 0 });
    }
  });

  it("cambiar el link invalida el viejo y el nuevo", async () => {
    setup();
    expect((await changeFormSlug({ formId: FORM, slug: "nuevo-link", confirm: true })).ok).toBe(true);
    const tags = mocks.revalidateTag.mock.calls.map((c) => c[0]);
    expect(tags).toEqual(expect.arrayContaining(["form:aplicacion", "form:nuevo-link"]));
  });

  it("una acción que no tuvo éxito NO invalida nada", async () => {
    setup({ status: "archived" });
    expect((await publishForm(FORM)).ok).toBe(false);
    expect((await setFormStatus(FORM, "published")).ok).toBe(false);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("si revalidateTag lanza, la acción sigue siendo un éxito", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup();
    mocks.revalidateTag.mockImplementation(() => {
      throw new Error("fuera de un request");
    });
    expect((await publishForm(FORM)).ok).toBe(true);
  });
});

describe("formCacheTag", () => {
  it("siempre en minúsculas: el slug del link y el de la base se llaman igual", async () => {
    const { formCacheTag } = await import("@/lib/forms/site-load");
    expect(formCacheTag("Aplicacion")).toBe("form:aplicacion");
  });
});
