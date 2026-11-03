import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const upsertContactForSender = vi.fn();
vi.mock("@/lib/inbox-sync", () => ({ upsertContactForSender }));
const recordTouch = vi.fn();
vi.mock("@/lib/contacts/touch", () => ({ recordTouch }));
const getEvolutionConfig = vi.fn();
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig }));
const logAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ logAudit }));

const { runGroupImport, GROUP_IMPORT_JOB } = await import("./import");
const { IMPORT_BATCH } = await import("./settings");

const NOW = new Date("2026-11-03T12:00:00Z");

function setup(over: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb({
    whatsapp_groups: [{ id: "g-1", workspace_id: "ws-1", channel_id: "ch-1", group_jid: "120363001122334455@g.us", subject: "Comunidad", in_inbox: true, save_contacts: false, left_at: null }],
    channels: [{ id: "ch-1", workspace_id: "ws-1", late_account_id: "evolution:ssa-1", platform: "whatsapp", username: null, display_name: "WhatsApp +5491100000000", evolution_instance: "ssa-1" }],
    whatsapp_group_members: [],
    automation_events: [],
    ...over,
  });
}

const member = (n: number) => ({ id: `54911${String(n).padStart(8, "0")}@s.whatsapp.net`, phoneNumber: null, lid: null, admin: false, name: `Persona ${n}` });

beforeEach(() => {
  vi.clearAllMocks();
  getEvolutionConfig.mockResolvedValue({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" });
  upsertContactForSender.mockImplementation(async ({ senderId }: { senderId: string }) => ({ contactId: `c-${senderId}`, existed: false }));
  recordTouch.mockResolvedValue({ recorded: true });
});

describe("runGroupImport", () => {
  it("crea los contactos con el toque de importacion, sin disparar automatizaciones, y deja el historial", async () => {
    const memory = setup();
    const fetchParticipants = vi.fn(async () => [member(1), member(2), { id: "5491100000000@s.whatsapp.net", phoneNumber: null, lid: null, admin: true, name: "Yo" }]);
    const outcome = await runGroupImport(memory.client as never, { workspaceId: "ws-1", groupId: "g-1", requestedBy: "u-1" }, { fetchParticipants, now: () => NOW });

    expect(outcome).toBe("done");
    expect(upsertContactForSender).toHaveBeenCalledTimes(2); // el propio numero no
    expect(memory.rows("whatsapp_group_members").map((m) => m.source)).toEqual(["import", "import"]);
    expect(recordTouch.mock.calls[0][1].touch.raw).toMatchObject({ group_event: "import" });
    expect(memory.rows("automation_events")).toHaveLength(0);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ event: "import_members", members: 3, imported: 2 }), performedBy: "u-1" }));
  });

  it("un grupo grande sigue en la proxima vuelta de la cola, con la misma clave", async () => {
    const memory = setup();
    const schedule = vi.fn(async () => ({ id: "j" }));
    const all = Array.from({ length: IMPORT_BATCH + 5 }, (_, i) => member(i + 1));
    const outcome = await runGroupImport(memory.client as never, { workspaceId: "ws-1", groupId: "g-1", requestedBy: null }, { fetchParticipants: vi.fn(async () => all), schedule: schedule as never, now: () => NOW });

    expect(outcome).toBe("next");
    expect(upsertContactForSender).toHaveBeenCalledTimes(IMPORT_BATCH);
    expect(schedule).toHaveBeenCalledWith(expect.anything(), GROUP_IMPORT_JOB, expect.objectContaining({ offset: IMPORT_BATCH, imported: IMPORT_BATCH }), NOW, "whatsapp_group_import:g-1");
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("si Evolution falla, reagenda a 1 minuto sin lanzar; al cuarto intento lo deja", async () => {
    const memory = setup();
    const schedule = vi.fn(async () => ({ id: "j" }));
    const fetchParticipants = vi.fn(async () => {
      throw new Error("502");
    });
    expect(await runGroupImport(memory.client as never, { workspaceId: "ws-1", groupId: "g-1", requestedBy: null }, { fetchParticipants, schedule: schedule as never, now: () => NOW })).toBe("retry");
    expect(schedule.mock.calls[0][3]).toEqual(new Date(NOW.getTime() + 60_000));
    expect(await runGroupImport(memory.client as never, { workspaceId: "ws-1", groupId: "g-1", requestedBy: null, attempt: 4 }, { fetchParticipants, schedule: schedule as never, now: () => NOW })).toBe("gave_up");
  });

  it("un grupo de otro negocio o desactivado no se importa", async () => {
    const memory = setup();
    expect(await runGroupImport(memory.client as never, { workspaceId: "otro", groupId: "g-1", requestedBy: null }, { fetchParticipants: vi.fn(), now: () => NOW })).toBe("skipped");
  });
});
