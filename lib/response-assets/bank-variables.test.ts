import { describe, expect, it, vi } from "vitest";
import { hasBankVariables, resolveBankVariables } from "./bank-variables";

function client(contact: Record<string, unknown> | null, workspace: Record<string, unknown> | null): { client: never; from: ReturnType<typeof vi.fn> } {
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: table === "contacts" ? contact : workspace, error: null }),
    };
    return chain;
  });
  return { client: { from } as never, from };
}

const ctx = { workspaceId: "ws-1", contactId: "c-1" };

describe("hasBankVariables", () => {
  it("reconoce las cuatro variables de la banca, con o sin espacios", () => {
    expect(hasBankVariables("Hola {{contact.display_name}}")).toBe(true);
    expect(hasBankVariables("{{ workspace.name }}")).toBe(true);
    expect(hasBankVariables("{{contact.email}}")).toBe(true);
  });

  it("no confunde otras variables de flow", () => {
    expect(hasBankVariables("Tu reunión: {{booking.start_invitee}}")).toBe(false);
    expect(hasBankVariables("Sin variables")).toBe(false);
  });
});

describe("resolveBankVariables", () => {
  it("resuelve con los datos reales del contacto y del negocio", async () => {
    const { client: c } = client({ display_name: "Ana", email: "a@x.com", phone: "+54" }, { name: "Mi Negocio" });
    const [out] = await resolveBankVariables(c, ctx, ["Hola {{contact.display_name}}, soy de {{workspace.name}}"]);
    expect(out).toBe("Hola Ana, soy de Mi Negocio");
  });

  it("sin variables de la banca no consulta la base: lo mas comun cuesta cero", async () => {
    const { client: c, from } = client(null, null);
    const out = await resolveBankVariables(c, ctx, ["Hola", "Tu reunión: {{booking.start_invitee}}"]);
    expect(out).toEqual(["Hola", "Tu reunión: {{booking.start_invitee}}"]);
    expect(from).not.toHaveBeenCalled();
  });

  it("resuelve varios textos con una sola lectura, y deja intacto lo que no es de la banca", async () => {
    const { client: c, from } = client({ display_name: "Ana", email: null, phone: null }, { name: "Mi Negocio" });
    const out = await resolveBankVariables(c, ctx, ["Asunto {{contact.display_name}}", "Cuerpo {{booking.start_invitee}} {{workspace.name}}"]);
    expect(out).toEqual(["Asunto Ana", "Cuerpo {{booking.start_invitee}} Mi Negocio"]);
    // Dos tablas, una vez cada una: no una lectura por texto.
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("un dato que el contacto no tiene queda vacio, no como {{...}} (es un texto que va a un lead)", async () => {
    const { client: c } = client({ display_name: null, email: null, phone: null }, { name: "Mi Negocio" });
    expect(await resolveBankVariables(c, ctx, ["Hola {{contact.display_name}}!"])).toEqual(["Hola !"]);
  });
});

// @plantilla-desde(formularios)
describe("{{form_link.<slug>}} (Formularios, F20)", () => {
  const S = "11111111-1111-4111-8111-111111111111";

  /** Un cliente que solo conoce `forms`; cuenta las lecturas por tabla. */
  function formsClient(forms: Array<{ id: string; slug: string }>) {
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: table === "forms" ? forms : null, error: null });
      return chain;
    });
    return { client: { from } as never, from };
  }

  it("un texto SIN el token no hace consultas nuevas", async () => {
    const { client: c, from } = formsClient([]);
    expect(await resolveBankVariables(c, ctx, ["Hola", "{{booking.x}}"])).toEqual(["Hola", "{{booking.x}}"]);
    expect(from).not.toHaveBeenCalled();
  });

  it("firma el link para el contacto del flujo y lo pone en el texto", async () => {
    const spy = vi.spyOn(await import("@/lib/forms/signed-link"), "signFormLink").mockImplementation(async (_s, input) => `https://app.x/f/${input.slug}?c=tok-${input.contactId}`);
    const { client: c } = formsClient([{ id: "form-1", slug: "como-vas" }]);
    const [out] = await resolveBankVariables(c, ctx, ["Contanos: {{form_link.como_vas}}"]);
    expect(out).toBe("Contanos: https://app.x/f/como-vas?c=tok-c-1");
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspaceId: "ws-1", formId: "form-1", contactId: "c-1", serviceId: null, saleId: null }));
    spy.mockRestore();
  });

  it("con service.id en las variables del flujo, el token lleva ese id y la URL no lo trae en claro", async () => {
    const spy = vi.spyOn(await import("@/lib/forms/signed-link"), "signFormLink").mockImplementation(async (_s, input) => `https://app.x/f/${input.slug}?c=firmado(${input.serviceId ? "con-servicio" : "sin"})`);
    const { client: c } = formsClient([{ id: "form-1", slug: "como-vas" }]);
    const [out] = await resolveBankVariables(c, { ...ctx, variables: { service: { id: S } } }, ["{{form_link.como_vas}}"]);
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ serviceId: S }));
    expect(out).not.toContain(S);
    spy.mockRestore();
  });

  it("si el formulario no existe, el token queda tal cual", async () => {
    const { client: c } = formsClient([]);
    expect(await resolveBankVariables(c, ctx, ["{{form_link.nada}}"])).toEqual(["{{form_link.nada}}"]);
  });

  it("si firmar falla, el mensaje sale igual (con el token) y no se cae", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spy = vi.spyOn(await import("@/lib/forms/signed-link"), "signFormLink").mockRejectedValue(new Error("vault caido"));
    const { client: c } = formsClient([{ id: "form-1", slug: "como-vas" }]);
    expect(await resolveBankVariables(c, ctx, ["{{form_link.como_vas}}"])).toEqual(["{{form_link.como_vas}}"]);
    spy.mockRestore();
    err.mockRestore();
  });
});
// @plantilla-hasta(formularios)
