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
