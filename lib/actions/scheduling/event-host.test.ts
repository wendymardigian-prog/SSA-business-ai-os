/**
 * Cambiar el anfitrion de un evento: quien puede, que lo frena y que queda escrito.
 * La funcion de la base esta simulada; la de verdad se prueba con
 * `scripts/verify-scheduling.mjs --despues-de-00290`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schedulingWorld, EVENT, HOST, WS } from "@/lib/scheduling/testing/world";
import type { MemoryDb } from "@/lib/agent/testing/memory-db";

const NEW_HOST = "user-2";

const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  service: vi.fn(),
  rpc: vi.fn(),
  members: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: () => mocks.ctx() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => mocks.service() }));
vi.mock("@/lib/workspace-members", () => ({ getWorkspaceMembers: () => mocks.members() }));

const { changeEventHost } = await import("./event-types");

let db: MemoryDb;

function setup({ manageOthers = true, event = {}, newHostProfile = {} }: { manageOthers?: boolean; event?: Record<string, unknown>; newHostProfile?: Record<string, unknown> | null } = {}) {
  db = schedulingWorld({ event });
  if (newHostProfile) {
    db.rows("scheduling_profiles").push({ id: "prof-2", workspace_id: WS, user_id: NEW_HOST, username: "beto", display_name: "Beto", is_active: true, default_destination_calendar_id: null, ...newHostProfile });
    db.rows("availability_schedules").push({ ...db.rows("availability_schedules")[0], id: "sch-2", user_id: NEW_HOST });
  }
  mocks.ctx.mockResolvedValue({
    workspace: { id: WS },
    user: { id: HOST, email: "ana@ejemplo.com" },
    supabase: db.client,
    can: (key: string) => key !== "scheduling.manage_others" || manageOthers,
  });
  mocks.service.mockReturnValue(Object.assign(Object.create(db.client), { rpc: mocks.rpc }));
  mocks.members.mockResolvedValue([
    { userId: HOST, name: "Ana", email: "ana@ejemplo.com" },
    { userId: NEW_HOST, name: "Beto", email: "beto@ejemplo.com" },
  ]);
  mocks.rpc.mockResolvedValue({ data: { status: "ok", old_username: "ana", new_username: "beto", slug: "llamada-de-triaje" }, error: null });
}

// Sin Google: asi el evento no pide Meet y ningun caso depende de un calendario.
const manual = { location_type: "manual", location_text: "Oficina" };

beforeEach(() => {
  vi.clearAllMocks();
  setup({ event: manual });
});

describe("changeEventHost", () => {
  it("con permiso, cambia y deja el historial con el antes y el después", async () => {
    expect(await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST })).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("change_event_type_host", {
      p_workspace_id: WS,
      p_event_type_id: EVENT,
      p_expected_host_id: HOST,
      p_new_host_id: NEW_HOST,
    });
    const entry = db.rows("audit_log").find((a) => a.action === "event_type.host_changed");
    expect(entry?.changes).toEqual({ owner_user_id: { old: HOST, new: NEW_HOST }, username: { old: "ana", new: "beto" } });
  });

  it("el dueño sin manage_others no puede darle su evento a otra persona", async () => {
    setup({ manageOthers: false, event: manual });
    const result = await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("permiso") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("alguien de afuera del equipo no se puede elegir, aunque tenga perfil", async () => {
    mocks.members.mockResolvedValue([{ userId: HOST, name: "Ana", email: "ana@ejemplo.com" }]);
    const result = await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("equipo") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("un evento activo no pasa a quien tiene la agenda desactivada", async () => {
    setup({ event: manual, newHostProfile: { is_active: false } });
    const result = await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("agenda desactivada") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("un evento con Meet y activo no pasa a quien no tiene Google Calendar", async () => {
    setup({ event: { location_type: "google_meet" } });
    const result = await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Google Meet") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("un evento inactivo pasa igual: lo que falte lo dice al activarlo", async () => {
    setup({ event: { status: "inactive", location_type: "google_meet" }, newHostProfile: { is_active: false } });
    expect(await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST })).toEqual({ ok: true });
  });

  it("si la persona ya tiene un evento con ese link, dice qué hacer y no deja historial", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "slug_taken" }, error: null });
    const result = await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Cambiale el link") });
    expect(db.rows("audit_log").some((a) => a.action === "event_type.host_changed")).toBe(false);
  });

  it("un error de la base no muestra el detalle técnico", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await changeEventHost({ eventId: EVENT, newHostUserId: NEW_HOST });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("No pude cambiar") });
    spy.mockRestore();
  });
});
