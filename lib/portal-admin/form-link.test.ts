import { describe, it, expect, vi } from "vitest";
import { resolveFormLink, type FormLinkDeps, type FormLinkGrant } from "./form-link";

const SESSION = "a".repeat(64);
const ITEM = "55555555-5555-4555-8555-555555555555";
const GRANT: FormLinkGrant = {
  workspace_id: "11111111-1111-4111-8111-111111111111",
  form_id: "22222222-2222-4222-8222-222222222222",
  slug: "contrato",
  contact_id: "33333333-3333-4333-8333-333333333333",
  service_id: "44444444-4444-4444-8444-444444444444",
  sale_id: null,
  item_id: ITEM,
};

function deps(over: Partial<FormLinkDeps> = {}): FormLinkDeps {
  return {
    grant: vi.fn(async () => ({ ok: true as const, data: GRANT })),
    baseUrl: vi.fn(async () => "https://links.negocio.com"),
    sign: vi.fn(async (s) => `${s.baseUrl}/f/${s.slug}?c=tok`),
    ...over,
  };
}

describe("resolveFormLink", () => {
  it("firma el link con el paso, el servicio y el contacto que devolvió la base", async () => {
    const d = deps();
    const r = await resolveFormLink({ session: SESSION, item_id: ITEM }, d);
    expect(r).toEqual({ status: 200, body: { ok: true, url: "https://links.negocio.com/f/contrato?c=tok" } });
    expect(d.sign).toHaveBeenCalledWith(expect.objectContaining({ itemId: ITEM, serviceId: GRANT.service_id, contactId: GRANT.contact_id, formId: GRANT.form_id }));
    expect(d.baseUrl).toHaveBeenCalledWith(GRANT.workspace_id);
  });

  it("una sesión o un paso con forma inválida no llegan a la base", async () => {
    const d = deps();
    expect((await resolveFormLink({ session: "x", item_id: ITEM }, d)).status).toBe(400);
    expect((await resolveFormLink({ session: SESSION, item_id: "no-uuid" }, d)).status).toBe(400);
    expect((await resolveFormLink({}, d)).status).toBe(400);
    expect(d.grant).not.toHaveBeenCalled();
  });

  it("si la base dice que no, devuelve solo su código propio y no firma nada", async () => {
    const d = deps({ grant: vi.fn(async () => ({ ok: false as const, error: { code: "PO409", message: "Este paso ya está completo", detail: null } })) });
    expect(await resolveFormLink({ session: SESSION, item_id: ITEM }, d)).toEqual({
      status: 403,
      body: { ok: false, code: "PO409", message: "Este paso ya está completo" },
    });
    expect(d.sign).not.toHaveBeenCalled();

    const pg = deps({ grant: vi.fn(async () => ({ ok: false as const, error: { code: "22P02", message: "detalle interno", detail: null } })) });
    const r = await resolveFormLink({ session: SESSION, item_id: ITEM }, pg);
    expect(r.body).toEqual({ ok: false, code: null, message: "No se pudo hacer. Probá de nuevo en un rato." });
  });

  it("si no se puede firmar (Vault), responde 500 sin link", async () => {
    const d = deps({ sign: vi.fn(async () => { throw new Error("vault"); }) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveFormLink({ session: SESSION, item_id: ITEM }, d)).toEqual({ status: 500, body: { ok: false } });
    spy.mockRestore();
  });
});
