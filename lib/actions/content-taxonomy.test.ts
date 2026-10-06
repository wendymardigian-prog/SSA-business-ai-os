/**
 * F89: las acciones de pilares y ofertas.
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
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
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
  db = memoryDb({ content_pillars: [], content_offers: [], workspace_roles: [] });
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

  it("devuelve el id para que el selector lo deje elegido", async () => {
    const result = await actions.createOffer({ name: "Mentoria" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.id).toBe(db.rows("content_offers")[0].id);
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

    const result = await actions.createOffer({ name: "Mentoria" });

    expect(result.ok).toBe(true);
  });

  it("un rol con content.approve pero sin settings.manage no crea", async () => {
    customRole(["content.view", "content.approve"]);

    expect((await actions.createPillar({ name: "X" })).ok).toBe(false);
    expect((await actions.renameOffer({ id: "a", name: "Y" })).ok).toBe(false);
    expect((await actions.archivePillar({ id: "a" })).ok).toBe(false);
  });
});

describe("renombrar y archivar", () => {
  beforeEach(() => {
    db = memoryDb({
      content_pillars: [
        { id: "p1", workspace_id: WS, name: "Educativo", color: "#6366f1", archived_at: null },
        { id: "p2", workspace_id: WS, name: "Autoridad", color: "#0ea5e9", archived_at: null },
      ],
      content_offers: [],
      workspace_roles: [],
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
