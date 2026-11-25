import { describe, expect, it, vi } from "vitest";
import { cleanSystemAlertText, notifySystemFailure, systemAlertEntityId } from "./system-alerts";
import { linkFor } from "./types";

interface Row {
  workspace_id: string;
  type: string;
  entity_id: string | null;
  created_at: string;
  read_at: string | null;
}

/** Un cliente mínimo: `notifications` en memoria, con los filtros que usa el helper. */
function fakeClient(rows: Row[] = [], opts: { selectError?: boolean } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      expect(table).toBe("notifications");
      const filters: Array<(r: Row) => boolean> = [];
      const q = {
        select: () => q,
        eq: (col: keyof Row, v: unknown) => (filters.push((r) => r[col] === v), q),
        gte: (col: keyof Row, v: string) => (filters.push((r) => String(r[col]) >= v), q),
        limit: async () =>
          opts.selectError ? { data: null, error: { message: "caída" } } : { data: rows.filter((r) => filters.every((f) => f(r))), error: null },
        insert: async (row: Record<string, unknown>) => (inserts.push(row), { error: null }),
      };
      return q;
    },
  };
  return { client, inserts };
}

const base = {
  workspaceId: "ws-1",
  type: "system_job_failed" as const,
  key: "job:svc_daily",
  title: "Falló el barrido diario de Servicios",
  body: "Motivo: tiempo agotado",
  area: "integrations" as const,
  now: new Date("2026-11-24T12:00:00Z"),
};

describe("notifySystemFailure", () => {
  it("crea el aviso sin destinatario, con entidad system y el área", async () => {
    const { client, inserts } = fakeClient();
    expect(await notifySystemFailure({ ...base, supabase: client })).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      workspace_id: "ws-1",
      type: "system_job_failed",
      recipient_id: null,
      entity_type: "system",
      entity_id: systemAlertEntityId("system_job_failed", "job:svc_daily"),
      metadata: { area: "integrations", key: "job:svc_daily" },
    });
  });

  it("no repite en 7 días aunque el anterior ya se haya leído", async () => {
    const entity = systemAlertEntityId("system_job_failed", "job:svc_daily");
    const read: Row = { workspace_id: "ws-1", type: "system_job_failed", entity_id: entity, created_at: "2026-11-20T10:00:00.000Z", read_at: "2026-11-20T11:00:00.000Z" };
    const { client, inserts } = fakeClient([read]);
    expect(await notifySystemFailure({ ...base, supabase: client })).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("pasados los 7 días, o con otra clave, vuelve a avisar", async () => {
    const entity = systemAlertEntityId("system_job_failed", "job:svc_daily");
    const old: Row = { workspace_id: "ws-1", type: "system_job_failed", entity_id: entity, created_at: "2026-11-10T10:00:00.000Z", read_at: null };
    const { client, inserts } = fakeClient([old]);
    expect(await notifySystemFailure({ ...base, supabase: client })).toBe(true);
    expect(await notifySystemFailure({ ...base, key: "job:ghl_read", supabase: client })).toBe(true);
    expect(inserts).toHaveLength(2);
  });

  it("si no puede comprobar, avisa igual; sin negocio, no hace nada", async () => {
    const { client, inserts } = fakeClient([], { selectError: true });
    expect(await notifySystemFailure({ ...base, supabase: client })).toBe(true);
    expect(await notifySystemFailure({ ...base, workspaceId: null, supabase: client })).toBe(false);
    expect(inserts).toHaveLength(1);
  });

  it("nunca lanza, aunque el cliente explote", async () => {
    const boom = { from: vi.fn(() => { throw new Error("roto"); }) };
    await expect(notifySystemFailure({ ...base, supabase: boom })).resolves.toBe(false);
  });

  it("limpia emails, teléfonos y tokens, y recorta", () => {
    const text = cleanSystemAlertText("falló para persona@example.com (+34 600 123 456) con Bearer abc.def en https://x.com/a?token=1");
    expect(text).not.toContain("persona@example.com");
    expect(text).not.toContain("600 123 456");
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain("token=1");
    expect(cleanSystemAlertText("a".repeat(900)).length).toBeLessThanOrEqual(400);
  });
});

describe("linkFor de un fallo del sistema", () => {
  it("lleva a la pantalla del área, y a Integraciones si no la conoce", () => {
    expect(linkFor("system", "x", { area: "ads" })).toBe("/dashboard/anuncios");
    expect(linkFor("system", "x", { area: "team" })).toBe("/dashboard/settings/team");
    expect(linkFor("system", "x", { area: "channels" })).toBe("/dashboard/channels");
    expect(linkFor("system", "x", { area: "inventada" })).toBe("/dashboard/settings/integrations");
    expect(linkFor("system", null, {})).toBe("/dashboard/settings/integrations");
  });
});

describe("notifyTeamConnectionLost", () => {
  it("usa el nombre de la persona, nunca el email, y una clave por conexión", async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const q = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      limit: async () => ({ data: [], error: null }),
      insert: async (row: Record<string, unknown>) => (inserts.push(row), { error: null }),
    };
    const client = {
      from: () => q,
      rpc: async () => ({ data: [{ user_id: "u-1", full_name: "Persona Prueba", email: "persona@example.com" }], error: null }),
    };
    const { notifyTeamConnectionLost } = await import("./system-alerts");
    expect(
      await notifyTeamConnectionLost({ supabase: client, workspaceId: "ws-1", userId: "u-1", provider: "fathom", connectionId: "c-1" }),
    ).toBe(true);
    expect(inserts[0]).toMatchObject({ type: "team_connection_lost", recipient_id: null, entity_type: "system" });
    expect(String(inserts[0].title)).toContain("Persona Prueba");
    expect(JSON.stringify(inserts[0])).not.toContain("persona@example.com");
    expect(inserts[0].metadata).toMatchObject({ area: "team", key: "fathom:c-1" });
  });

  it("sin persona no avisa", async () => {
    const { notifyTeamConnectionLost } = await import("./system-alerts");
    expect(await notifyTeamConnectionLost({ supabase: {}, workspaceId: "ws-1", userId: null, provider: "google_calendar", connectionId: "c" })).toBe(false);
  });
});
