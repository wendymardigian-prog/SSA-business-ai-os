/**
 * F89: las acciones de pilares y productos (las ofertas de antes, 00134).
 *
 * Fija tres cosas: que sin `settings.manage` no se escribe nada, que archivar
 * deja la fila (nunca se borra) y que NO existe una accion de borrar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";

let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined), diffFields: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "user-1" },
    workspace: { id: WS },
    role,
    roleId,
    supabase: db.client,
  }),
}));

const actions = await import("./content-taxonomy");

/** La base en memoria con el catalogo y la funcion de publicar (espejo de publish_product_version, 00159). */
function mem(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb(
    { content_pillars: [], products: [], product_variants: [], product_versions: [], workspace_roles: [], ...seed },
    {
      rpc: {
        publish_product_version: (args, d) => {
          const versions = d.rows("product_versions");
          const target = versions.find((v) => v.id === args.p_version_id)!;
          const prev = versions.find((v) => v.product_variant_id === target.product_variant_id && v.status === "active");
          if (prev) prev.status = "deprecated";
          target.status = "active";
          return { version_id: target.id, deprecated_version_id: prev?.id ?? null };
        },
      },
    },
  );
}

function customRole(keys: string[]) {
  role = "member";
  roleId = "rol-1";
  db.rows("workspace_roles").push({
    id: "rol-1",
    workspace_id: WS,
    system_role: null,
    permissions: { keys, scopes: { leads: "all", conversations: "all" } },
  });
}

beforeEach(() => {
  role = "admin";
  roleId = null;
  db = mem();
});

describe("crear", () => {
  it("un admin crea un pilar y le toca el primer color de la paleta", async () => {
    const result = await actions.createPillar({ name: "  Educativo " });

    expect(result).toMatchObject({ ok: true, data: { name: "Educativo", color: "#6366f1" } });
    expect(db.rows("content_pillars")).toHaveLength(1);
    expect(db.rows("content_pillars")[0]).toMatchObject({ workspace_id: WS, name: "Educativo" });
  });

  it("el segundo pilar sin color elegido recibe otro color", async () => {
    await actions.createPillar({ name: "Educativo" });
    const second = await actions.createPillar({ name: "Autoridad" });

    expect(second).toMatchObject({ ok: true });
    const colors = db.rows("content_pillars").map((r) => r.color);
    expect(new Set(colors).size).toBe(2);
  });

  it("un pilar devuelve el id para que el selector lo deje elegido", async () => {
    const result = await actions.createPillar({ name: "Educativo" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.id).toBe(db.rows("content_pillars")[0].id);
  });

  it("rechaza un duplicado sin mirar mayusculas", async () => {
    await actions.createPillar({ name: "Educativo" });
    const again = await actions.createPillar({ name: "educativo" });

    expect(again).toMatchObject({ ok: false });
    expect(db.rows("content_pillars")).toHaveLength(1);
  });

  it("rechaza un color que no es #rrggbb", async () => {
    const result = await actions.createPillar({ name: "X", color: "rojo" });

    expect(result.ok).toBe(false);
    expect(db.rows("content_pillars")).toHaveLength(0);
  });
});

describe("permiso", () => {
  it("un Member comun no crea nada", async () => {
    role = "member";

    const result = await actions.createPillar({ name: "Educativo" });

    expect(result.ok).toBe(false);
    expect(db.rows("content_pillars")).toHaveLength(0);
  });

  it("un rol personalizado con settings.manage SI crea", async () => {
    customRole(["settings.manage"]);

    const result = await actions.createProduct({ name: "Mentoria", priceUsd: 1500 });

    expect(result.ok).toBe(true);
  });

  it("un rol con content.approve pero sin settings.manage no crea", async () => {
    customRole(["content.view", "content.approve"]);

    expect((await actions.createPillar({ name: "X" })).ok).toBe(false);
    expect((await actions.createProduct({ name: "Y", priceUsd: 10 })).ok).toBe(false);
    expect((await actions.updateProduct({ id: "a", name: "Y" })).ok).toBe(false);
    expect((await actions.archivePillar({ id: "a" })).ok).toBe(false);
  });
});

describe("renombrar y archivar", () => {
  beforeEach(() => {
    db = mem({
      content_pillars: [
        { id: "p1", workspace_id: WS, name: "Educativo", color: "#6366f1", archived_at: null },
        { id: "p2", workspace_id: WS, name: "Autoridad", color: "#0ea5e9", archived_at: null },
      ],
    });
  });

  it("renombra", async () => {
    expect(await actions.renamePillar({ id: "p1", name: "Educacion" })).toEqual({ ok: true });
    expect(db.rows("content_pillars")[0].name).toBe("Educacion");
  });

  it("no renombra al nombre de otro", async () => {
    const result = await actions.renamePillar({ id: "p1", name: "Autoridad" });

    expect(result.ok).toBe(false);
    expect(db.rows("content_pillars")[0].name).toBe("Educativo");
  });

  it("archivar NO borra la fila: queda con su fecha", async () => {
    expect(await actions.archivePillar({ id: "p1" })).toEqual({ ok: true });

    expect(db.rows("content_pillars")).toHaveLength(2);
    expect(db.rows("content_pillars")[0].archived_at).toBeTruthy();
  });

  it("restaurar lo devuelve al selector", async () => {
    await actions.archivePillar({ id: "p1" });
    await actions.restorePillar({ id: "p1" });

    expect(db.rows("content_pillars")[0].archived_at).toBeNull();
  });

  it("no restaura si mientras tanto se creo otro con el mismo nombre", async () => {
    await actions.archivePillar({ id: "p1" });
    await actions.createPillar({ name: "Educativo" });

    const result = await actions.restorePillar({ id: "p1" });

    expect(result.ok).toBe(false);
    expect(db.rows("content_pillars").find((r) => r.id === "p1")?.archived_at).toBeTruthy();
  });

  it("cambia el color, pero solo a uno valido", async () => {
    expect(await actions.setPillarColor({ id: "p1", color: "#ef4444" })).toEqual({ ok: true });
    expect(db.rows("content_pillars")[0].color).toBe("#ef4444");

    expect((await actions.setPillarColor({ id: "p1", color: "azul" })).ok).toBe(false);
    expect(db.rows("content_pillars")[0].color).toBe("#ef4444");
  });

  it("un id de otro workspace no se toca", async () => {
    db.rows("content_pillars").push({
      id: "ajeno", workspace_id: "otro-ws", name: "Ajeno", color: "#6366f1", archived_at: null,
    });

    const result = await actions.archivePillar({ id: "ajeno" });

    expect(result.ok).toBe(false);
    expect(db.rows("content_pillars").find((r) => r.id === "ajeno")?.archived_at).toBeNull();
  });
});

describe("productos: atajos del catalogo de Ventas", () => {
  const product = (over: Record<string, unknown> = {}) => ({
    id: "pr1", workspace_id: WS, name: "Mentoria", description: null, product_type: "otro", status: "active", archived_at: null, display_order: 0, ...over,
  });
  const variant = (over: Record<string, unknown> = {}) => ({
    id: "va1", workspace_id: WS, product_id: "pr1", name: "Estandar", duration_type: "lifetime", duration_value: null,
    guarantee_duration_type: null, guarantee_duration_value: null, billing_type: "one_time", billing_interval: null, display_order: 0, archived_at: null, ...over,
  });
  const version = (over: Record<string, unknown> = {}) => ({
    id: "ve1", workspace_id: WS, product_variant_id: "va1", version_number: 1, price: 1500, change_notes: null, status: "active", ...over,
  });
  const activeVersions = () => db.rows("product_versions").filter((v) => v.status === "active");

  it("crea un producto activo con su variante Estandar y su version 1 YA publicada", async () => {
    const result = await actions.createProduct({ name: "  Mentoria  ", priceUsd: "1500,5" });

    expect(result).toMatchObject({ ok: true, data: { name: "Mentoria", priceUsd: 1500.5, status: "active" } });
    expect(db.rows("products")[0]).toMatchObject({ workspace_id: WS, name: "Mentoria", status: "active" });
    expect(db.rows("product_variants")).toHaveLength(1);
    expect(activeVersions()).toHaveLength(1);
    expect(activeVersions()[0]).toMatchObject({ price: 1500.5, version_number: 1 });
    expect(result.ok && result.data.id).toBe(db.rows("products")[0].id);
  });

  it("el precio es obligatorio: sin precio no se crea nada", async () => {
    for (const bad of [undefined, null, "", "  ", "mil", -5]) {
      expect((await actions.createProduct({ name: "Mentoria", priceUsd: bad })).ok).toBe(false);
    }
    expect(db.rows("products")).toHaveLength(0);
  });

  it("rechaza un nombre repetido entre los activos, sin mirar mayusculas", async () => {
    await actions.createProduct({ name: "Mentoria", priceUsd: 10 });
    const again = await actions.createProduct({ name: "mentoria", priceUsd: 20 });

    expect(again).toMatchObject({ ok: false });
    expect(db.rows("products")).toHaveLength(1);
  });

  describe("editar", () => {
    beforeEach(() => {
      db = mem({ products: [product()], product_variants: [variant()], product_versions: [version()] });
    });

    it("cambiar el precio NO lo pisa: publica una version nueva y la anterior queda deprecated", async () => {
      expect(await actions.updateProduct({ id: "pr1", priceUsd: 2000 })).toEqual({ ok: true });
      expect(db.rows("products")[0]).toMatchObject({ name: "Mentoria", status: "active", archived_at: null });
      expect(activeVersions().map((v) => v.price)).toEqual([2000]);
      expect(db.rows("product_versions").find((v) => v.id === "ve1")).toMatchObject({ status: "deprecated", price: 1500 });
    });

    it("el mismo precio no crea una version", async () => {
      expect(await actions.updateProduct({ id: "pr1", priceUsd: 1500 })).toEqual({ ok: true });
      expect(db.rows("product_versions")).toHaveLength(1);
    });

    it("renombra, pero no al nombre de otro producto activo", async () => {
      db.rows("products").push(product({ id: "pr2", name: "Curso" }));
      expect(await actions.updateProduct({ id: "pr1", name: "Curso" })).toMatchObject({ ok: false });
      expect(await actions.updateProduct({ id: "pr1", name: "Mentoria VIP" })).toEqual({ ok: true });
      expect(db.rows("products").find((r) => r.id === "pr1")?.name).toBe("Mentoria VIP");
    });

    it("inactivo y discontinuado quedan archivados (estado y archivado van juntos); NO se borra la fila", async () => {
      expect(await actions.updateProduct({ id: "pr1", status: "inactive" })).toEqual({ ok: true });
      const inactive = db.rows("products")[0];
      expect(inactive).toMatchObject({ status: "inactive" });
      expect(inactive.archived_at).toBeTruthy();

      const when = inactive.archived_at;
      expect(await actions.updateProduct({ id: "pr1", status: "discontinued" })).toEqual({ ok: true });
      // Pasar de un archivado a otro conserva cuando salio de circulacion.
      expect(db.rows("products")[0]).toMatchObject({ status: "discontinued", archived_at: when });
      expect(db.rows("products")).toHaveLength(1);
    });

    it("volver a activo lo desarchiva", async () => {
      await actions.updateProduct({ id: "pr1", status: "discontinued" });
      expect(await actions.updateProduct({ id: "pr1", status: "active" })).toEqual({ ok: true });
      expect(db.rows("products")[0]).toMatchObject({ status: "active", archived_at: null });
    });

    it("no reactiva si mientras tanto se creo otro activo con el mismo nombre", async () => {
      await actions.updateProduct({ id: "pr1", status: "discontinued" });
      db.rows("products").push(product({ id: "pr2", name: "Mentoria" }));

      const result = await actions.updateProduct({ id: "pr1", status: "active" });

      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Renombr") });
      expect(db.rows("products").find((r) => r.id === "pr1")?.status).toBe("discontinued");
    });

    it("rechaza un estado que no existe y un precio invalido, sin escribir nada", async () => {
      expect(await actions.updateProduct({ id: "pr1", status: "archivado" })).toMatchObject({ ok: false });
      expect(await actions.updateProduct({ id: "pr1", priceUsd: -1 })).toMatchObject({ ok: false });
      expect(await actions.updateProduct({ id: "pr1", priceUsd: "" })).toMatchObject({ ok: false });
      expect(db.rows("products")[0]).toMatchObject({ status: "active" });
      expect(db.rows("product_versions")).toHaveLength(1);
    });

    it("un producto de otro workspace no se toca", async () => {
      db.rows("products").push(product({ id: "ajeno", workspace_id: "ws-2", name: "Otro" }));
      expect(await actions.updateProduct({ id: "ajeno", status: "inactive" })).toMatchObject({ ok: false });
      expect(db.rows("products").find((r) => r.id === "ajeno")?.status).toBe("active");
    });
  });

  it("no hay una accion de borrar un producto: los estados son la salida", () => {
    expect(Object.keys(actions).filter((name) => /Offer/.test(name))).toEqual([]);
  });
});

describe("borrar no existe (F89)", () => {
  it("el modulo no exporta ninguna accion de borrar", () => {
    expect(Object.keys(actions).filter((name) => /delete|remove|borrar|eliminar/i.test(name))).toEqual([]);
  });

  it("el codigo de las acciones tampoco llama a .delete()", () => {
    const source = readFileSync("lib/actions/content-taxonomy.ts", "utf8");
    expect(source).not.toMatch(/\.delete\(/);
  });

  it("la migracion no le da policy de DELETE a ninguna de las dos tablas", () => {
    const sql = readFileSync("supabase/migrations/00116_content_taxonomy.sql", "utf8");
    // Una sola mencion: el DROP POLICY IF EXISTS que deja la tabla sin ella.
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });
});
