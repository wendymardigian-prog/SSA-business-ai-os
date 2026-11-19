import { describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/ai-proposals/create", () => ({
  createProposal: vi.fn(async (_db: unknown, input: unknown) => {
    created.calls.push(input);
    return { id: "p-1" };
  }),
}));
vi.mock("@/lib/tasks/core", () => ({ createTaskCore: vi.fn(async () => ({ ok: true, data: { id: "t-1" } })) })); // @plantilla-quitar(tareas)
vi.mock("@/lib/knowledge/person-search", () => ({ searchKnowledgeForPerson: vi.fn(async () => ({ ok: true, chunks: [] })) }));

import { asAiSdkTools, runPersonTool, toolsForPerson } from "./run";
import { DEFAULT_ASSISTANT_TOOL_KEYS, PERSON_TOOLS } from "./registry";
import type { PersonToolContext } from "./types";

const rolePerms = (keys: string[]) => (key: string) => keys.includes(key);

function emptyQuery(rows: unknown[] = []) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "neq", "order", "limit", "ilike", "in", "or", "gte"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  return q;
}

function ctx(keys: string[], rows: unknown[] = []): PersonToolContext {
  const client = { from: () => emptyQuery(rows), schema: () => ({ from: () => emptyQuery(rows) }) };
  return { supabase: client as never, service: client as never, workspaceId: "ws-1", userId: "u-1", timeZone: "America/Argentina/Buenos_Aires", can: rolePerms(keys) };
}

describe("capa de herramientas propia", () => {
  it("cada herramienta declara nombre, parámetros, permiso y si lee o escribe", () => {
    for (const t of PERSON_TOOLS) {
      expect(t.key).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(["read", "write"]).toContain(t.access);
      expect(t.permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(t.params).toBeDefined();
    }
    // Decisión de Wendy (18/11/2026): lee contactos, conversaciones, tareas, agenda, servicios y Conocimiento; propone tarea y nota.
    expect([...DEFAULT_ASSISTANT_TOOL_KEYS].sort()).toEqual(
      [
        "buscar_conocimiento",
        "crear_nota",
        "crear_tarea", // @plantilla-quitar(tareas)
        "ver_agenda",
        "ver_contactos",
        "ver_conversaciones",
        "ver_servicios", // @plantilla-quitar(servicios)
        "ver_tareas", // @plantilla-quitar(tareas)
      ].sort(),
    );
    // Las de escritura son solo crear tarea y nota.
    expect(PERSON_TOOLS.filter((t) => t.access === "write").map((t) => t.key).sort()).toEqual(
      [
        "crear_nota",
        "crear_tarea", // @plantilla-quitar(tareas)
      ].sort(),
    );
  });

  it("sin «Usar el asistente» no se ofrece nada, aunque tenga los demás permisos", () => {
    expect(toolsForPerson(rolePerms(["services.view", "tasks.view", "tasks.edit"]))).toEqual([]);
  });

  it("solo las herramientas que su rol permite (sin contacts.edit no ve «crear nota»)", () => {
    const keys = toolsForPerson(rolePerms(["assistant.use", "contacts.view", "bookings.view"])).map((t) => t.key);
    expect(keys).toContain("ver_contactos");
    expect(keys).toContain("ver_agenda");
    expect(keys).not.toContain("crear_nota");
    expect(keys).not.toContain("buscar_conocimiento");
    expect(Object.keys(asAiSdkTools(ctx(["assistant.use", "bookings.view"]), { agentId: null, runId: null }))).toEqual(["ver_agenda"]);
  });

  it("solo las habilitadas para el asistente", () => {
    expect(toolsForPerson(rolePerms(["assistant.use", "contacts.view", "bookings.view"]), ["ver_agenda"]).map((t) => t.key)).toEqual(["ver_agenda"]);
  });

  it("el servidor vuelve a comprobar el permiso: sin «Usar el asistente» o sin la clave, rechaza sin datos", async () => {
    expect(await runPersonTool(ctx(["bookings.view"]), "ver_agenda", {}, { byAi: true })).toMatchObject({ ok: false, code: "no_access" });
    expect(await runPersonTool(ctx(["assistant.use"]), "ver_agenda", {}, { byAi: true })).toMatchObject({ ok: false, code: "no_access", message: "No tenés acceso a eso." });
    expect(await runPersonTool(ctx(["assistant.use", "bookings.view"]), "inventada", {}, { byAi: true })).toMatchObject({ ok: false, code: "no_access" });
  });

  it("algo que su rol no ve (la base no devuelve filas): «No tenés acceso a eso», sin datos", async () => {
    const out = await runPersonTool(ctx(["assistant.use", "bookings.view"], []), "ver_agenda", {}, { byAi: true });
    expect(out).toEqual({ ok: false, code: "no_access", message: "No tenés acceso a eso." });
  });

  it("una lectura que sí ve devuelve los datos", async () => {
    const out = await runPersonTool(ctx(["assistant.use", "bookings.view"], [{ id: "b", title: "Llamada" }]), "ver_agenda", {}, { byAi: true });
    expect(out).toMatchObject({ ok: true, data: [{ id: "b", title: "Llamada" }] });
  });

  it("una escritura pedida por la IA no se ejecuta: queda propuesta a nombre de la persona", async () => {
    created.calls.length = 0;
    const contact = "6f1c2b9e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
    const out = await runPersonTool(ctx(["assistant.use", "contacts.edit"]), "crear_nota", { contacto_id: contact, texto: "Pidió el precio" }, { byAi: true, agentId: "a-1" });
    expect(out).toMatchObject({ ok: true, proposed: true, proposalId: "p-1" });
    expect(created.calls[0]).toMatchObject({ executor: "person_tool", requestedBy: "u-1", toolKey: "crear_nota", label: "Dejar una nota en la ficha" });
  });

  // @plantilla-desde(tareas)
  it("ya aprobada por la persona, se ejecuta con su identidad", async () => {
    const out = await runPersonTool(ctx(["assistant.use", "tasks.edit"]), "crear_tarea", { titulo: "Llamar a la clienta" }, { byAi: false, approved: true });
    expect(out).toMatchObject({ ok: true, entityId: "t-1" });
  });
  // @plantilla-hasta(tareas)

  it("parámetros que no cumplen el esquema: inválido, sin ejecutar", async () => {
    expect(await runPersonTool(ctx(["assistant.use", "contacts.edit"]), "crear_nota", { contacto_id: "no-es-uuid", texto: "" }, { byAi: false, approved: true })).toMatchObject({ ok: false, code: "invalid" });
  });
});
