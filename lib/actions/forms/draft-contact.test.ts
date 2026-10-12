import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { saveFormDraft } from "./forms";
import { newField } from "@/lib/forms/fields";

const FORM = "11111111-1111-4111-8111-111111111111";

function setup() {
  const row = { id: FORM, workspace_id: "ws1", name: "F", type: "custom", status: "draft", slug: "f", updated_at: "2026-10-12T10:00:00Z" };
  const service = fakeDb({
    "forms:select": { data: row },
    "forms:update": { data: { updated_at: "2026-10-12T10:00:01Z" } },
    "custom_field_definitions:select": { data: [] },
  });
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: fakeDb().client, can: () => true });
  mocks.service.mockResolvedValue(service.client);
  return service;
}

beforeEach(() => vi.clearAllMocks());

describe("el borrador y el mapeo al contacto se guardan JUNTOS (R4)", () => {
  const email = newField("email", "email", "Email");
  const definition = { fields: [email] };

  it("escribe la definición y el mapeo en una misma actualización", async () => {
    const service = setup();
    const contactConfig = { mode: "create_or_link", update: "fill_empty", map: [{ fieldKey: "email", target: "contact.email" }] };
    const result = await saveFormDraft({ formId: FORM, definition, contactConfig });
    expect(result).toEqual({ ok: true, updatedAt: "2026-10-12T10:00:01Z" });
    const writes = service.writesTo("forms");
    expect(writes).toHaveLength(1);
    expect(writes[0].values).toMatchObject({ draft_definition: { fields: [email] }, contact_config: contactConfig });
  });

  it("un mapeo a un campo que el borrador no tiene se saca: nunca queda colgado", async () => {
    const service = setup();
    const contactConfig = {
      mode: "create_or_link",
      update: "fill_empty",
      map: [
        { fieldKey: "email", target: "contact.email" },
        { fieldKey: "borrado", target: "contact.phone" },
      ],
    };
    await saveFormDraft({ formId: FORM, definition, contactConfig });
    expect(service.writesTo("forms")[0].values).toMatchObject({
      contact_config: { mode: "create_or_link", update: "fill_empty", map: [{ fieldKey: "email", target: "contact.email" }] },
    });
  });

  it("sin mapeo en el pedido no toca contact_config (el guardado viejo sigue igual)", async () => {
    const service = setup();
    await saveFormDraft({ formId: FORM, definition });
    expect(service.writesTo("forms")[0].values).not.toHaveProperty("contact_config");
  });
});
