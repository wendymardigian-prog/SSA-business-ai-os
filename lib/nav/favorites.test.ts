import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSION_KEYS, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { NAV_ITEMS, isFavoriteCandidate, navSections, parseNavFavorites, sectionTitleTarget, visibleNavItems } from "./items";

describe("parseNavFavorites / isFavoriteCandidate (00357)", () => {
  it("acepta un item de su propia seccion", () => {
    expect(parseNavFavorites({ ventas: "/dashboard/contacts", herramientas: "/dashboard/flows" })).toEqual({
      ventas: "/dashboard/contacts",
      herramientas: "/dashboard/flows",
    });
  });

  it("descarta un href de otra seccion, uno inventado, un grupo sin titulo y lo que no es texto", () => {
    expect(
      parseNavFavorites({
        ventas: "/dashboard/flows",
        adquisicion: "https://otro-sitio.com",
        inicio: "/dashboard/inbox",
        herramientas: 42,
        cualquiera: "/dashboard/contacts",
      }),
    ).toEqual({});
  });

  it("lo que no es un objeto da {} y nunca lanza", () => {
    for (const raw of [null, undefined, "x", 3, [], ["ventas"]]) expect(parseNavFavorites(raw)).toEqual({});
  });

  it("isFavoriteCandidate es la misma lista blanca", () => {
    expect(isFavoriteCandidate("ventas", "/dashboard/agenda")).toBe(true);
    expect(isFavoriteCandidate("ventas", "/dashboard/agenda/otra")).toBe(false);
    expect(isFavoriteCandidate("inicio", "/dashboard/inbox")).toBe(false);
    expect(isFavoriteCandidate("ventas", null)).toBe(false);
  });
});

describe("sectionTitleTarget: a donde lleva el titulo de una seccion cerrada", () => {
  const sectionsFor = (keys: string[]) => navSections(visibleNavItems(NAV_ITEMS, { permissionKeys: keys, flags: { settings: true, inbox: true } }));

  it("con favorita visible, lleva a ella", () => {
    const ventas = sectionsFor(ALL_PERMISSION_KEYS).find((s) => s.group === "ventas")!;
    expect(sectionTitleTarget(ventas, { ventas: "/dashboard/agenda" }, { permissionKeys: ALL_PERMISSION_KEYS })).toBe("/dashboard/agenda");
  });

  it("sin favorita, no navega (el click solo abre)", () => {
    const ventas = sectionsFor(ALL_PERMISSION_KEYS).find((s) => s.group === "ventas")!;
    expect(sectionTitleTarget(ventas, {}, { permissionKeys: ALL_PERMISSION_KEYS })).toBe(null);
  });

  it("una favorita que la persona no ve (sin permiso) se ignora", () => {
    const keys = ["contacts.view"];
    const ventas = sectionsFor(keys).find((s) => s.group === "ventas")!;
    expect(ventas.items.map((i) => i.name)).toEqual(["Contactos"]);
    expect(sectionTitleTarget(ventas, { ventas: "/dashboard/agenda" }, { permissionKeys: keys })).toBe(null);
  });

  it("Ajustes como favorita lleva a la primera pestaña que la persona ve, como el item", () => {
    const keys = SYSTEM_ROLE_PERMISSIONS.member.keys;
    const herramientas = sectionsFor(keys).find((s) => s.group === "herramientas")!;
    const ajustes = herramientas.items.find((i) => i.href === "/dashboard/settings");
    expect(ajustes).toBeTruthy();
    const target = sectionTitleTarget(herramientas, { herramientas: "/dashboard/settings" }, { permissionKeys: keys });
    expect(target).not.toBe(null);
    expect(target).not.toBe("/dashboard/settings/general");
  });

  it("una seccion que no es colapsable nunca navega", () => {
    const inicio = sectionsFor(ALL_PERMISSION_KEYS).find((s) => s.group === "inicio")!;
    expect(sectionTitleTarget(inicio, { inicio: "/dashboard/inbox" } as never, { permissionKeys: ALL_PERMISSION_KEYS })).toBe(null);
  });
});

// ── La accion que guarda ────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  user: { id: "u-1" } as { id: string } | null,
  row: null as { nav_favorites: unknown } | null,
  readError: null as { message: string } | null,
  updates: [] as unknown[],
  inserts: [] as unknown[],
  insertError: null as { code?: string; message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user }, error: null }) },
    from: (table: string) => {
      if (table !== "user_preferences") throw new Error(`tabla inesperada: ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: db.readError }) }) }),
        update: (values: unknown) => ({
          eq: async () => {
            db.updates.push(values);
            return { error: null };
          },
        }),
        insert: async (values: unknown) => {
          db.inserts.push(values);
          return { error: db.insertError };
        },
      };
    },
  }),
}));

describe("setNavFavorite", () => {
  beforeEach(() => {
    db.user = { id: "u-1" };
    db.row = { nav_favorites: { herramientas: "/dashboard/flows" } };
    db.readError = null;
    db.updates = [];
    db.inserts = [];
    db.insertError = null;
  });

  it("rechaza un grupo que no existe o sin titulo, sin tocar la base", async () => {
    const { setNavFavorite } = await import("@/lib/actions/nav-favorites");
    expect((await setNavFavorite({ group: "inicio", href: "/dashboard/inbox" })).ok).toBe(false);
    expect((await setNavFavorite({ group: "otra", href: "/dashboard/contacts" })).ok).toBe(false);
    expect(db.updates).toEqual([]);
  });

  it("rechaza un href de otra seccion o inventado", async () => {
    const { setNavFavorite } = await import("@/lib/actions/nav-favorites");
    expect((await setNavFavorite({ group: "ventas", href: "/dashboard/flows" })).ok).toBe(false);
    expect((await setNavFavorite({ group: "ventas", href: "https://otro-sitio.com" })).ok).toBe(false);
    expect(db.updates).toEqual([]);
  });

  it("suma la favorita conservando las de otras secciones", async () => {
    const { setNavFavorite } = await import("@/lib/actions/nav-favorites");
    const result = await setNavFavorite({ group: "ventas", href: "/dashboard/contacts" });
    expect(result).toEqual({ ok: true, favorites: { herramientas: "/dashboard/flows", ventas: "/dashboard/contacts" } });
    expect(db.updates).toEqual([{ nav_favorites: { herramientas: "/dashboard/flows", ventas: "/dashboard/contacts" } }]);
  });

  it("con href null saca la de esa seccion", async () => {
    const { setNavFavorite } = await import("@/lib/actions/nav-favorites");
    const result = await setNavFavorite({ group: "herramientas", href: null });
    expect(result).toEqual({ ok: true, favorites: {} });
  });

  it("sin fila todavia, la crea con la zona del navegador; sin zona valida, no", async () => {
    const { setNavFavorite } = await import("@/lib/actions/nav-favorites");
    db.row = null;
    expect((await setNavFavorite({ group: "ventas", href: "/dashboard/contacts" })).ok).toBe(false);
    expect(db.inserts).toEqual([]);
    const ok = await setNavFavorite({ group: "ventas", href: "/dashboard/contacts", browserTimezone: "America/Costa_Rica" });
    expect(ok.ok).toBe(true);
    expect(db.inserts).toEqual([
      { user_id: "u-1", timezone: "America/Costa_Rica", timezone_source: "browser", nav_favorites: { ventas: "/dashboard/contacts" } },
    ]);
  });

  it("sin sesion no guarda nada", async () => {
    const { setNavFavorite } = await import("@/lib/actions/nav-favorites");
    db.user = null;
    expect((await setNavFavorite({ group: "ventas", href: "/dashboard/contacts" })).ok).toBe(false);
    expect(db.updates).toEqual([]);
  });

  it("un error al leer no se toma como 'sin favoritas' (no pisa lo guardado)", async () => {
    const { setNavFavorite } = await import("@/lib/actions/nav-favorites");
    db.readError = { message: "boom" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await setNavFavorite({ group: "ventas", href: "/dashboard/contacts" })).ok).toBe(false);
    expect(db.updates).toEqual([]);
    spy.mockRestore();
  });
});
