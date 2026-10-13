import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import type { TaskCtx } from "./core";
import { createFollowupTaskCore } from "./followup-core";
import { makeTask, taskId } from "./fixtures";

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

const CID = "00000000-0000-4000-8000-0000000000c1";
const ctxOf = (supabase: unknown, service: unknown): TaskCtx => ({ supabase: supabase as never, service: service as never, workspaceId: "ws-1", userId: "u-1", timeZone: "UTC" });
const contactRow = { id: CID, display_name: "Ana Pérez", email: null };

describe("createFollowupTaskCore (R2)", () => {
  it("crea con el cliente de servicio: titulo, vencimiento, responsable, contacto y clave de origen", async () => {
    const user = fakeDb({ contacts: { data: contactRow } });
    const created = makeTask({ id: taskId(1), contact_id: CID, source_ref: "followup:2026-10-20" });
    const service = fakeDb({ tasks: (call) => (call.op === "insert" ? { data: created } : { data: null }) });
    const res = await createFollowupTaskCore(ctxOf(user.client, service.client), CID, "2026-10-20");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.existing).toBe(false);
    const insert = service.writesTo("tasks")[0];
    expect(insert.values).toMatchObject({
      workspace_id: "ws-1",
      title: "Seguimiento a Ana Pérez",
      due_date: "2026-10-20",
      owner_id: "u-1",
      contact_id: CID,
      source: "manual",
      source_ref: "followup:2026-10-20",
      created_by: "u-1",
    });
    // Nada se escribio con la sesion de la persona.
    expect(user.writes()).toHaveLength(0);
  });

  it("un contacto que la persona no ve no se acepta y no se escribe nada", async () => {
    const user = fakeDb({ contacts: { data: null } });
    const service = fakeDb();
    const res = await createFollowupTaskCore(ctxOf(user.client, service.client), CID, "2026-10-20");
    expect(res.ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("datos invalidos: ni toca la base", async () => {
    const user = fakeDb();
    const service = fakeDb();
    expect((await createFollowupTaskCore(ctxOf(user.client, service.client), "no-es-uuid", "2026-10-20")).ok).toBe(false);
    expect((await createFollowupTaskCore(ctxOf(user.client, service.client), CID, "2026-02-31")).ok).toBe(false);
    expect(user.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("si ya existe, devuelve la existente sin insertar", async () => {
    const found = makeTask({ id: taskId(7), contact_id: CID, source_ref: "followup:2026-10-20" });
    const user = fakeDb({ contacts: { data: contactRow }, tasks: { data: found } });
    const service = fakeDb({ tasks: { data: { id: found.id } } });
    const res = await createFollowupTaskCore(ctxOf(user.client, service.client), CID, "2026-10-20");
    expect(res.ok && res.data.existing && res.data.task.id).toBe(found.id);
    expect(service.writes()).toHaveLength(0);
  });

  it("dos creaciones a la vez: el indice rechaza la segunda y se devuelve la existente", async () => {
    const found = makeTask({ id: taskId(8), contact_id: CID, source_ref: "followup:2026-10-20" });
    let lookups = 0;
    const user = fakeDb({ contacts: { data: contactRow }, tasks: { data: found } });
    const service = fakeDb({
      tasks: (call) => {
        if (call.op === "insert") return { data: null, error: { message: "duplicate key", code: "23505" } };
        lookups += 1;
        return lookups === 1 ? { data: null } : { data: { id: found.id } };
      },
    });
    const res = await createFollowupTaskCore(ctxOf(user.client, service.client), CID, "2026-10-20");
    expect(res.ok && res.data.existing).toBe(true);
  });

  it("existe pero la persona no la puede ver: avisa sin devolverla", async () => {
    const user = fakeDb({ contacts: { data: contactRow }, tasks: { data: null } });
    const service = fakeDb({ tasks: { data: { id: taskId(9) } } });
    const res = await createFollowupTaskCore(ctxOf(user.client, service.client), CID, "2026-10-20");
    expect(res).toMatchObject({ ok: false, code: "conflict" });
  });

  it("un error de la base no lanza", async () => {
    const user = fakeDb({ contacts: { data: contactRow } });
    const service = fakeDb({ tasks: (call) => (call.op === "insert" ? { data: null, error: { message: "boom" } } : { data: null }) });
    const res = await createFollowupTaskCore(ctxOf(user.client, service.client), CID, "2026-10-20");
    expect(res).toMatchObject({ ok: false, code: "server" });
  });
});
