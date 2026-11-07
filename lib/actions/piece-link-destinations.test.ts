/**
 * «Armar un link» de una pieza: qué formularios y agendas recibe cada persona. La base es en memoria (los filtros se
 * aplican de verdad); la RLS se prueba contra la base real en los verify-*. Acá: las claves, el workspace de la sesión y
 * que sin una clave ni se consulta esa tabla.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
let db: MemoryDb;
let granted = new Set<string>();
const tablesRead: string[] = [];

vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    granted.has(key)
      ? {
          workspace: { id: WS, scheduling_public_base_url: "https://links.negocio.com" },
          user: { id: "u-1" },
          supabase: { from: (table: string) => (tablesRead.push(table), db.client.from(table as never)) },
          can: (k: string) => granted.has(k),
        }
      : null,
}));

const { loadPieceLinkDestinations } = await import("./piece-link-destinations");

beforeEach(() => {
  granted = new Set(["content.view", "forms.view", "scheduling.use"]);
  tablesRead.length = 0;
  db = memoryDb({
    forms: [
      { id: "f-1", workspace_id: WS, name: "Aplicación", slug: "aplicacion", type: "custom", status: "published", current_version_id: "v-1", contact_config: {} },
      { id: "f-x", workspace_id: "ws-otro", name: "Ajeno", slug: "ajeno", type: "custom", status: "published", current_version_id: "v-2", contact_config: {} },
    ],
    event_types: [
      { id: "e-1", workspace_id: WS, title: "Llamada", slug: "ventas", status: "active", owner_user_id: "u-1", is_internal: false, deleted_at: null },
      { id: "e-int", workspace_id: WS, title: "Interno", slug: "interno", status: "active", owner_user_id: "u-1", is_internal: true, deleted_at: null },
      { id: "e-x", workspace_id: "ws-otro", title: "Ajeno", slug: "x", status: "active", owner_user_id: "u-9", is_internal: false, deleted_at: null },
    ],
    scheduling_profiles: [
      { user_id: "u-1", workspace_id: WS, username: "ana", display_name: "Ana", is_active: true },
      { user_id: "u-9", workspace_id: "ws-otro", username: "otra", display_name: "Otra", is_active: true },
    ],
  });
});

describe("loadPieceLinkDestinations", () => {
  it("devuelve los formularios y las agendas del workspace de la sesión, con su dominio", async () => {
    expect(await loadPieceLinkDestinations()).toEqual({
      ok: true,
      destinations: {
        forms: [{ kind: "form", id: "f-1", label: "Aplicación", url: "https://links.negocio.com/f/aplicacion" }],
        events: [{ kind: "event", id: "e-1", label: "Llamada", url: "https://links.negocio.com/calendario/ana/ventas" }],
      },
    });
  });

  it("sin content.view responde error y no lee nada", async () => {
    granted = new Set(["forms.view", "scheduling.use"]);
    expect(await loadPieceLinkDestinations()).toEqual({ ok: false, error: expect.any(String) });
    expect(tablesRead).toEqual([]);
  });

  it("sin forms.view no consulta formularios", async () => {
    granted.delete("forms.view");
    const res = await loadPieceLinkDestinations();
    expect(res.ok && res.destinations.forms).toEqual([]);
    expect(tablesRead).not.toContain("forms");
  });

  it("sin permisos de agenda no consulta eventos; con bookings.view sí", async () => {
    granted.delete("scheduling.use");
    const res = await loadPieceLinkDestinations();
    expect(res.ok && res.destinations.events).toEqual([]);
    expect(tablesRead).not.toContain("event_types");

    granted.add("bookings.view");
    const again = await loadPieceLinkDestinations();
    expect(again.ok && again.destinations.events.map((e) => e.id)).toEqual(["e-1"]);
  });

  it("si la base falla, avisa sin tumbar el panel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Cada consulta responde con un error de la base, como lo hace supabase-js.
    const failed = { data: null, error: { message: "caída" } };
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve(failed) : () => chain),
    });
    db = { ...db, client: { from: () => chain } as never };
    const res = await loadPieceLinkDestinations();
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/pegar el link a mano/) });
  });
});
