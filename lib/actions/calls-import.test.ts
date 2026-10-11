import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const guards = vi.hoisted(() => ({ getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);
const server = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => server.service }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => "a1") }));
vi.mock("@/lib/audit", () => audit);
const queue = vi.hoisted(() => ({ enqueueClassify: vi.fn(async () => undefined) }));
vi.mock("@/lib/calls/queue", () => queue);

import { importCall } from "./calls-import";
import { IMPORT_LIMIT_PER_HOUR } from "@/lib/calls/transcript-import";

const WS = "ws-1";
const ME = "11111111-1111-4111-8111-111111111111";
const CLOSER = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";

function setup(opts: { member?: boolean; contactVisible?: boolean; bump?: number; bookings?: unknown[] } = {}) {
  const service = fakeDb(
    {
      "workspace_members:select": { data: opts.member === false ? null : { user_id: CLOSER } },
      "bookings:select": { data: opts.bookings ?? [] },
      "calls:insert": { data: { id: "call-1" } },
    },
    { bump_rate_limit: { data: (opts.bump ?? 1) as never } },
  );
  const user = fakeDb({ "contacts:select": { data: opts.contactVisible === false ? null : { id: CONTACT } } });
  server.service = service.client;
  guards.getPermissionAction.mockResolvedValue({ workspace: { id: WS }, user: { id: ME }, supabase: user.client });
  return { service, user };
}

const form = (over: Record<string, string | File> = {}) => {
  const f = new FormData();
  const base: Record<string, string | File> = { title: "Llamada con Ana", recordedAt: "2026-10-08T21:00:00.000Z", closerId: CLOSER, text: "Ana: Hola\nLeo: Buenas" };
  for (const [k, v] of Object.entries({ ...base, ...over })) f.set(k, v);
  return f;
};

beforeEach(() => vi.clearAllMocks());

describe("importCall", () => {
  it("sin contacto: queda sin vincular, se clasifica igual y se guarda como manual", async () => {
    const { service } = setup();
    const r = await importCall(form());
    expect(r).toEqual({ ok: true, id: "call-1" });
    const insert = service.writesTo("calls")[0].values as Record<string, unknown>;
    expect(insert).toMatchObject({ source: "manual", external_id: null, contact_id: null, link_method: "none", analysis_status: "classifying", created_by: ME, recorded_by_user_id: CLOSER });
    expect((insert.transcript as unknown[]).length).toBe(2);
    expect(queue.enqueueClassify).toHaveBeenCalledWith(service.client, "call-1", expect.any(Date));
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "call", action: "call.imported", performedBy: ME }));
  });

  it("un archivo de 3 MB se rechaza en el servidor aunque el navegador lo deje pasar", async () => {
    setup();
    const big = new File(["a".repeat(3 * 1024 * 1024)], "grande.vtt");
    const r = await importCall(form({ file: big, text: "" }));
    expect(r).toEqual({ ok: false, error: "El archivo pesa más de 2 MB" });
  });

  it("un .pdf se rechaza", async () => {
    setup();
    const r = await importCall(form({ file: new File(["x"], "x.pdf"), text: "" }));
    expect(r.ok).toBe(false);
  });

  it("un VTT subido conserva hablante y tiempo y calcula la duracion", async () => {
    const { service } = setup();
    const vtt = new File(["WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Ana>Hola\n\n00:10:00.000 --> 00:10:04.000\n<v Leo>Chau"], "llamada.vtt");
    await importCall(form({ file: vtt, text: "" }));
    const insert = service.writesTo("calls")[0].values as Record<string, unknown>;
    expect(insert.duration_seconds).toBe(600);
    expect((insert.transcript as Array<{ speaker: { display_name: string } }>)[0].speaker.display_name).toBe("Ana");
  });

  it("con contacto visible: queda vinculada a mano, con quien la vinculo", async () => {
    const { service } = setup();
    await importCall(form({ contactId: CONTACT }));
    expect(service.writesTo("calls")[0].values).toMatchObject({ contact_id: CONTACT, link_method: "manual", linked_by: ME });
  });

  it("toma la agenda del contacto en la ventana de ±4 h", async () => {
    const { service } = setup({ bookings: [{ id: "b-1", contact_id: CONTACT, host_user_id: CLOSER, start_at: "2026-10-08T20:30:00Z", created_at: "2026-10-01T00:00:00Z", booker_email: null, status_group: "active" }] });
    await importCall(form({ contactId: CONTACT }));
    expect(service.writesTo("calls")[0].values).toMatchObject({ booking_id: "b-1" });
  });

  it("un contacto que quien importa no ve se rechaza", async () => {
    const { service } = setup({ contactVisible: false });
    const r = await importCall(form({ contactId: CONTACT }));
    expect(r.ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("un closer que no es del equipo se rechaza", async () => {
    setup({ member: false });
    expect((await importCall(form())).ok).toBe(false);
  });

  it("sin calls.edit responde sin permiso", async () => {
    setup();
    guards.getPermissionAction.mockResolvedValue(null);
    expect((await importCall(form())).ok).toBe(false);
  });

  it("datos invalidos: titulo vacio, fecha rota, fecha futura, texto vacio", async () => {
    setup();
    expect((await importCall(form({ title: "  " }))).ok).toBe(false);
    expect((await importCall(form({ recordedAt: "ayer" }))).ok).toBe(false);
    expect((await importCall(form({ recordedAt: new Date(Date.now() + 5 * 86400_000).toISOString() }))).ok).toBe(false);
    expect((await importCall(form({ text: "   " }))).ok).toBe(false);
  });

  it("el limite es de 20 por hora y por persona", async () => {
    const { service } = setup({ bump: IMPORT_LIMIT_PER_HOUR + 1 });
    const r = await importCall(form());
    expect(r.ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });
});
