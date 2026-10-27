/**
 * D5: guardar un flujo PUBLICADO por la API se valida igual que al publicar (con las aristas y `publishing: true`).
 * Un borrador se puede guardar a medias. La base es en memoria; el permiso y el usuario están simulados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

let db: MemoryDb;
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: async () => ({ workspace: { id: "ws-1" } }) }));
// El workspace ACTIVO de la sesion (lib/workspace.ts): las rutas ya no buscan "el primero" por su cuenta.
vi.mock("@/lib/workspace", () => ({ getActiveWorkspace: async () => ({ workspace: { id: "ws-1" } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: (table: string) => db.client.from(table as never),
  }),
}));

const { PUT } = await import("./route");

const trigger = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "webhook_received" } };
const upsert = { id: "u", type: "upsert_contact", position: { x: 0, y: 0 }, data: { mode: "create_or_update" } };
const message = { id: "m", type: "sendMessage", position: { x: 0, y: 0 }, data: { label: "Bienvenida", messages: [{ text: "Hola" }] } };
const whatsapp = { id: "w", type: "action", position: { x: 0, y: 0 }, data: { actionType: "send_whatsapp_number", to: "fixed", fixedPhone: "+5491122334455", channelId: "ch", text: "Hola" } };

const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
/** El mensaje SIN «Crear o actualizar contacto» antes: en un flujo de webhook no tiene contacto. */
const brokenNodes = [trigger, message];
const brokenEdges = [edge("t", "m")];
/** El mensaje DESPUÉS del contacto, por su salida «Listo». */
const goodNodes = [trigger, upsert, message];
const goodEdges = [edge("t", "u"), edge("u", "m", "ok")];

const put = (body: Record<string, unknown>) =>
  PUT(new NextRequest("https://app.test/api/v1/flows/f1", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ flowId: "f1" }) });

function world(status: "draft" | "published", nodes: unknown[] = goodNodes, edges: unknown[] = goodEdges) {
  db = memoryDb({
    workspace_members: [{ user_id: "u-1", workspace_id: "ws-1" }],
    flows: [{ id: "f1", workspace_id: "ws-1", name: "Mi flujo", status, nodes, edges, updated_at: "2026-10-01T00:00:00Z" }],
  });
}
const stored = () => db.rows("flows")[0] as { nodes: unknown[]; edges: unknown[]; name: string; draft_nodes?: unknown[]; draft_edges?: unknown[]; draft_updated_at?: string };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("PUT /flows/:id · flujo publicado (borrador, auditoria de automatizaciones)", () => {
  // Antes (D5) un grafo de una automatizacion publicada se validaba como al publicar y se escribia en `nodes`, que el
  // motor lee en vivo. Desde la 00254 va a los cambios sin publicar: lo que corre no cambia, y la validacion completa
  // la hace "Publicar cambios".
  it("un grafo a medias va al borrador: lo que corre no cambia", async () => {
    world("published");
    const res = await put({ nodes: brokenNodes, edges: brokenEdges });
    expect(res.status).toBe(200);
    expect(stored().nodes).toEqual(goodNodes);
    expect(stored().draft_nodes).toEqual(brokenNodes);
    expect(stored().draft_updated_at).toBeTruthy();
  });

  it("un grafo válido tambien va al borrador", async () => {
    world("published");
    const res = await put({ nodes: [...goodNodes, whatsapp], edges: [...goodEdges, edge("m", "w")] });
    expect(res.status).toBe(200);
    expect(stored().nodes).toHaveLength(3);
    expect(stored().draft_nodes).toHaveLength(4);
  });

  it("el paso «Enviar WhatsApp a un número» no necesita contacto: puede ir antes de «Crear o actualizar contacto»", async () => {
    world("published");
    const res = await put({ nodes: [trigger, whatsapp, upsert, message], edges: [edge("t", "w"), edge("w", "u"), edge("u", "m", "ok")] });
    expect(res.status).toBe(200);
  });

  it("si solo cambian las aristas, las aristas van al borrador", async () => {
    world("published");
    const res = await put({ edges: [edge("t", "m"), edge("t", "u")] });
    expect(res.status).toBe(200);
    expect(stored().edges).toEqual(goodEdges);
    expect(stored().draft_edges).toEqual([edge("t", "m"), edge("t", "u")]);
  });

  it("un cambio de nombre (sin nodos ni aristas) no valida nada", async () => {
    world("published", brokenNodes, brokenEdges); // aunque lo guardado ya estuviera mal, renombrar no se bloquea
    const res = await put({ name: "Otro nombre" });
    expect(res.status).toBe(200);
    expect(stored().name).toBe("Otro nombre");
  });
});

describe("PUT /flows/:id · borrador", () => {
  it("un borrador de webhook se puede guardar a medias (la regla frena la publicación)", async () => {
    world("draft");
    const res = await put({ nodes: brokenNodes, edges: brokenEdges });
    expect(res.status).toBe(200);
    expect(stored().nodes).toEqual(brokenNodes);
  });

  // @plantilla-desde(formularios)
  it("un flujo de una persona del equipo con un paso que necesita contacto se rechaza también como borrador", async () => {
    world("draft");
    const eodTrigger = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "eod_submitted" } };
    const res = await put({ nodes: [eodTrigger, message], edges: [edge("t", "m")] });
    expect(res.status).toBe(400);
  });
  // @plantilla-hasta(formularios)

  it("un flujo que no existe devuelve 404", async () => {
    world("draft");
    db.tables.flows.length = 0;
    const res = await put({ nodes: goodNodes, edges: goodEdges });
    expect(res.status).toBe(404);
  });
});
