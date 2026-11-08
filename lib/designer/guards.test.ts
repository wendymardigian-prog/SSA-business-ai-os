import { describe, expect, it, vi } from "vitest";

type Ctx = { can: (k: string) => boolean };
/** Lo que devuelve `getPermissionContext` en cada caso (una función simple: sin espías de por medio). */
let current: () => Promise<Ctx> = async () => ctxWith([]);
vi.mock("@/lib/auth/guards", () => ({ getPermissionContext: () => current() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { requireDesigner, designerAbilities } = await import("./guards");

function ctxWith(keys: string[]): Ctx {
  return { can: (k: string) => keys.includes(k) };
}

async function outcome(key: Parameters<typeof requireDesigner>[0]): Promise<string> {
  try {
    await requireDesigner(key);
    return "pasa";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("pantallas del Diseñador IA (F4): sin el permiso, 404", () => {
  it("sin designer.view, 404", async () => {
    current = async () => ctxWith(["contacts.view"]);
    expect(await outcome("designer.view")).toBe("NEXT_NOT_FOUND");
  });

  it("los ajustes piden designer.manage: con solo designer.view, 404", async () => {
    current = async () => ctxWith(["designer.view", "designer.edit"]);
    expect(await outcome("designer.manage")).toBe("NEXT_NOT_FOUND");
  });

  it("sin sesión o si falla la lectura del permiso, 404 (nunca abre)", async () => {
    current = () => Promise.reject(new Error("sin sesión"));
    expect(await outcome("designer.view")).toBe("NEXT_NOT_FOUND");
  });

  it("con la clave, pasa y devuelve el contexto", async () => {
    const ctx = ctxWith(["designer.view"]);
    current = async () => ctx;
    expect(await outcome("designer.view")).toBe("pasa");
    expect(await requireDesigner("designer.view")).toBe(ctx);
  });

  it("designerAbilities refleja cada clave por separado (lo que no da, se oculta)", () => {
    expect(designerAbilities(ctxWith(["designer.view", "designer.edit"]))).toEqual({ view: true, edit: true, publish: false, generate: false, manage: false });
  });
});
