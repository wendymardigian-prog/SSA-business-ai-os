import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const guards = vi.hoisted(() => ({ getMemberAction: vi.fn(), getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);
const server = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => server.service }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => "a1") }));
vi.mock("@/lib/audit", () => audit);
const vault = vi.hoisted(() => ({ stored: new Map<string, string>(), deleted: [] as string[], fail: false }));
vi.mock("@/lib/vault", async (orig) => {
  const actual = await orig<typeof import("@/lib/vault")>();
  return {
    ...actual,
    storeSecret: async (_s: unknown, _ws: string, name: string, value: string) => { if (vault.fail) return { ok: false, error: "x" }; vault.stored.set(name, value); return { ok: true }; },
    deleteSecret: async (_s: unknown, _ws: string, name: string) => { vault.deleted.push(name); return { ok: true, deleted: true }; },
  };
});
const queue = vi.hoisted(() => ({ queueFathomSyncNow: vi.fn() }));
vi.mock("@/lib/fathom/queue", () => queue);
const history = vi.hoisted(() => ({ startHistoryImport: vi.fn(), resumeHistoryImport: vi.fn(), stopHistoryImport: vi.fn() }));
vi.mock("@/lib/fathom/history-import", () => history);

import { disconnectFathom, resumeFathomHistoryImport, saveFathomApp, saveFathomSettings, saveMyFathomEmails, syncFathomNow, startFathomHistoryImport, stopFathomHistoryImport } from "./fathom";
import { validateFathomApp } from "@/lib/fathom/app-validation";

const WS = "ws-1";
const ME = { workspace: { id: WS }, user: { id: "user-ana" }, supabase: fakeDb().client };

beforeEach(() => {
  vi.clearAllMocks();
  vault.stored.clear(); vault.deleted.length = 0; vault.fail = false;
  guards.getMemberAction.mockResolvedValue(ME);
  guards.getPermissionAction.mockResolvedValue(ME);
});

describe("saveFathomApp", () => {
  it("guarda el Client ID y el Secret en Vault, audita SIN los valores y no los devuelve", async () => {
    server.service = fakeDb().client;
    const r = await saveFathomApp({ clientId: " cid-123456 ", clientSecret: "sec-ABCDEFGH" });
    expect(r).toEqual({ ok: true });
    expect(vault.stored.get("fathom_client_id")).toBe("cid-123456");
    expect(vault.stored.get("fathom_client_secret")).toBe("sec-ABCDEFGH");
    const logged = JSON.stringify(audit.logAudit.mock.calls);
    expect(logged).not.toContain("sec-ABCDEFGH");
    expect(logged).not.toContain("cid-123456");
  });

  it("sin integrations.manage responde sin permiso", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    const r = await saveFathomApp({ clientId: "cid-123456", clientSecret: "sec-ABCDEFGH" });
    expect(r.ok).toBe(false);
    expect(vault.stored.size).toBe(0);
  });

  it("rechaza valores que no parecen claves", () => {
    expect(validateFathomApp({ clientId: "corto", clientSecret: "sec-ABCDEFGH" })).toContain("Client ID");
    expect(validateFathomApp({ clientId: "cid-123456", clientSecret: "tiene espacios x" })).toContain("Secret");
    expect(validateFathomApp({ clientId: "cid-123456", clientSecret: "sec-ABCDEFGH" })).toBeNull();
  });

  it("si Vault falla, no dice que se guardo", async () => {
    server.service = fakeDb().client;
    vault.fail = true;
    expect((await saveFathomApp({ clientId: "cid-123456", clientSecret: "sec-ABCDEFGH" })).ok).toBe(false);
  });
});

describe("disconnectFathom", () => {
  const row = { id: "c1", workspace_id: WS, user_id: "user-ana", vault_secret_prefix: "oauth_fathom_c1", account_label: "ana@x.io" };

  it("borra los dos tokens de Vault y deja la conexion revocada (las llamadas no se tocan)", async () => {
    const db = fakeDb({ "oauth_connections:select": { data: row } });
    server.service = db.client;
    const r = await disconnectFathom("c1");
    expect(r).toEqual({ ok: true });
    expect(vault.deleted.sort()).toEqual(["oauth_fathom_c1_access_token", "oauth_fathom_c1_refresh_token"]);
    expect(db.writesTo("oauth_connections")[0].values).toMatchObject({ status: "revoked" });
    expect(db.writesTo("calls")).toHaveLength(0);
  });

  it("no puede desconectar la conexion de otra persona", async () => {
    const db = fakeDb({ "oauth_connections:select": { data: { ...row, user_id: "user-beto" } } });
    server.service = db.client;
    const r = await disconnectFathom("c1");
    expect(r.ok).toBe(false);
    expect(vault.deleted).toHaveLength(0);
    expect(db.writes()).toHaveLength(0);
  });

  it("una conexion que no existe: no la encuentra", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: null } }).client;
    expect((await disconnectFathom("nada")).ok).toBe(false);
  });
});

describe("syncFathomNow", () => {
  it("sin conexion activa: rechaza", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: null } }).client;
    const r = await syncFathomNow();
    expect(r.ok).toBe(false);
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
  });

  it("encola el job de SU conexion", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: { id: "c1", status: "active" } } }, { bump_rate_limit: { data: 1 as never } }).client;
    queue.queueFathomSyncNow.mockResolvedValue({ queued: true });
    const r = await syncFathomNow();
    expect(r.ok).toBe(true);
    expect(queue.queueFathomSyncNow).toHaveBeenCalledWith(expect.anything(), "c1", expect.any(Date));
  });

  it("la segunda vez seguida dice que ya se esta sincronizando", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: { id: "c1", status: "active" } } }, { bump_rate_limit: { data: 1 as never } }).client;
    queue.queueFathomSyncNow.mockResolvedValue({ queued: false, reason: "already" });
    const r = await syncFathomNow();
    expect(r).toEqual({ ok: true, message: "Ya se está sincronizando" });
  });

  it("mas de una vez por minuto se frena", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: { id: "c1", status: "active" } } }, { bump_rate_limit: { data: 2 as never } }).client;
    const r = await syncFathomNow();
    expect(r.ok).toBe(false);
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
  });

  it("pide calls.view: sin el permiso no hace nada", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    const r = await syncFathomNow();
    expect(r.ok).toBe(false);
    expect(guards.getPermissionAction).toHaveBeenCalledWith("calls.view");
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
  });
});

describe("saveMyFathomEmails", () => {
  const team = () => fakeDb(
    {
      "workspace_members:select": { data: [{ user_id: "user-ana", closer_emails: ["ana.vieja@gmail.com"] }, { user_id: "user-beto", closer_emails: [] }] },
      "oauth_connections:select": { data: { id: "c1", status: "active" } },
    },
    { workspace_member_profiles: { data: [{ user_id: "user-ana", email: "ana@negocio.io" }, { user_id: "user-beto", email: "beto@negocio.io" }] } },
  );

  it("guarda SOLO en la fila de quien tiene la sesion, normalizado", async () => {
    const db = team();
    server.service = db.client;
    const r = await saveMyFathomEmails(["ana.vieja@gmail.com", " ANA.Nueva@Gmail.com "]);
    expect(r).toEqual({ ok: true, emails: ["ana.vieja@gmail.com", "ana.nueva@gmail.com"] });
    const write = db.writesTo("workspace_members")[0];
    expect(write.values).toEqual({ closer_emails: ["ana.vieja@gmail.com", "ana.nueva@gmail.com"] });
    expect(write.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "user_id", value: "user-ana" }), expect.objectContaining({ column: "workspace_id", value: WS })]));
  });

  it("al sumar un correo vuelve a mirar los ultimos dias", async () => {
    const db = team();
    server.service = db.client;
    queue.queueFathomSyncNow.mockResolvedValue({ queued: true });
    await saveMyFathomEmails(["ana.vieja@gmail.com", "ana.nueva@gmail.com"]);
    expect(db.writesTo("oauth_connections")[0].values).toEqual({ sync_watermark: null, sync_cursor: null });
    expect(queue.queueFathomSyncNow).toHaveBeenCalledWith(expect.anything(), "c1");
  });

  it("al quitar un correo no vuelve a consultar", async () => {
    const db = team();
    server.service = db.client;
    await saveMyFathomEmails([]);
    expect(db.writesTo("oauth_connections")).toHaveLength(0);
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
  });

  it("rechaza un correo de otra persona, sin escribir", async () => {
    const db = team();
    server.service = db.client;
    const r = await saveMyFathomEmails(["beto@negocio.io"]);
    expect(r.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("sin calls.view no hace nada", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    expect((await saveMyFathomEmails(["a@b.com"])).ok).toBe(false);
  });
});

describe("importar el historial", () => {
  const conectada = () => { server.service = fakeDb({ "oauth_connections:select": { data: { id: "c1", status: "active" } } }).client; };

  it("arranca sobre SU conexion y lo deja en el historial", async () => {
    conectada();
    history.startHistoryImport.mockResolvedValue({ ok: true });
    const r = await startFathomHistoryImport({ from: "2026-01-01T15:00:00.000Z" });
    expect(r).toEqual({ ok: true });
    expect(history.startHistoryImport).toHaveBeenCalledWith(expect.anything(), "c1", "2026-01-01T15:00:00.000Z", { classifyAi: false });
    expect(JSON.stringify(audit.logAudit.mock.calls)).toContain("history_import_started");
  });

  it("todo el historial es from null", async () => {
    conectada();
    history.startHistoryImport.mockResolvedValue({ ok: true });
    await startFathomHistoryImport({ from: null });
    expect(history.startHistoryImport).toHaveBeenCalledWith(expect.anything(), "c1", null, { classifyAi: false });
  });

  it("rechaza una fecha que no es una fecha", async () => {
    conectada();
    expect((await startFathomHistoryImport({ from: "ayer" })).ok).toBe(false);
    expect(history.startHistoryImport).not.toHaveBeenCalled();
  });

  it("sin conexion viva no arranca, ni sigue", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: null } }).client;
    expect((await startFathomHistoryImport({ from: null })).ok).toBe(false);
    expect((await resumeFathomHistoryImport()).ok).toBe(false);
    expect(history.startHistoryImport).not.toHaveBeenCalled();
    expect(history.resumeHistoryImport).not.toHaveBeenCalled();
  });

  it("las tres piden calls.view", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    expect((await startFathomHistoryImport({ from: null })).ok).toBe(false);
    expect((await resumeFathomHistoryImport()).ok).toBe(false);
    expect((await stopFathomHistoryImport()).ok).toBe(false);
    expect(guards.getPermissionAction).toHaveBeenCalledWith("calls.view");
    expect(history.startHistoryImport).not.toHaveBeenCalled();
    expect(history.resumeHistoryImport).not.toHaveBeenCalled();
    expect(history.stopHistoryImport).not.toHaveBeenCalled();
  });

  it("seguir y frenar actuan sobre SU conexion", async () => {
    conectada();
    history.resumeHistoryImport.mockResolvedValue({ ok: true });
    history.stopHistoryImport.mockResolvedValue({ ok: true });
    await resumeFathomHistoryImport();
    await stopFathomHistoryImport();
    expect(history.resumeHistoryImport).toHaveBeenCalledWith(expect.anything(), "c1");
    expect(history.stopHistoryImport).toHaveBeenCalledWith(expect.anything(), "c1");
  });
});

describe("saveFathomSettings", () => {
  const AREA = "33333333-3333-4333-8333-333333333333";
  const OTHER = "44444444-4444-4444-8444-444444444444";
  const area = { id: AREA, parent_id: null, name: "Servicio", color: null, position: 0, is_system: true, archived_at: null, system_key: "servicio" };
  const auto = { mode: "auto" as const, rules: {}, default_area_id: null };
  const setup = (over: { owner?: string; settings?: unknown; can?: string[] } = {}) => {
    const can = over.can ?? ["calls.view"];
    guards.getMemberAction.mockResolvedValue({ ...ME, can: (k: string) => can.includes(k) });
    const db = fakeDb({
      "oauth_connections:select": { data: { id: OTHER, user_id: over.owner ?? "user-ana", fathom_settings: over.settings ?? {} } },
      "oauth_connections:update": { data: null },
      "booking_categories:select": { data: [area] },
    });
    server.service = db.client;
    return db;
  };

  it("guarda la propia, filtrando por el negocio y la persona de la sesion", async () => {
    const db = setup();
    const r = await saveFathomSettings({ settings: { mode: "rules", rules: { with_external: true }, default_area_id: AREA } });
    expect(r.ok).toBe(true);
    const w = db.writesTo("oauth_connections")[0];
    expect((w.values as { fathom_settings: { mode: string; default_area_id: string } }).fathom_settings).toMatchObject({ mode: "rules", default_area_id: AREA });
    expect(w.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "workspace_id", value: WS })]));
    expect(db.calls.find((c) => c.table === "oauth_connections")?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "user_id", value: "user-ana" })]));
    expect(JSON.stringify(audit.logAudit.mock.calls)).toContain("settings_changed");
  });

  it("sin calls.view no toca la propia", async () => {
    const db = setup({ can: [] });
    expect((await saveFathomSettings({ settings: auto })).ok).toBe(false);
    expect(db.writesTo("oauth_connections")).toHaveLength(0);
  });

  it("la de otra persona pide calls.configure", async () => {
    const db = setup({ owner: "user-beto" });
    expect((await saveFathomSettings({ connectionId: OTHER, settings: auto })).ok).toBe(false);
    expect(db.writesTo("oauth_connections")).toHaveLength(0);
  });

  it("con calls.configure la cambia, y queda en el historial a nombre de quien lo hizo", async () => {
    const db = setup({ owner: "user-beto", can: ["calls.configure"] });
    expect((await saveFathomSettings({ connectionId: OTHER, settings: auto })).ok).toBe(true);
    expect(db.writesTo("oauth_connections")).toHaveLength(1);
    expect((audit.logAudit.mock.calls as unknown[][])[0][0]).toMatchObject({ performedBy: "user-ana", metadata: { on_behalf_of: "user-beto" } });
  });

  it("un id que no es un id se rechaza", async () => {
    setup({ can: ["calls.configure"] });
    expect((await saveFathomSettings({ connectionId: "x", settings: auto })).ok).toBe(false);
  });

  it("un area que no es del negocio se rechaza", async () => {
    const db = setup();
    expect((await saveFathomSettings({ settings: { ...auto, default_area_id: OTHER } })).ok).toBe(false);
    expect(db.writesTo("oauth_connections")).toHaveLength(0);
  });

  it("al salir de manual avisa que lo anterior se trae con Importar, sin traerlo", async () => {
    const db = setup({ settings: { mode: "manual" } });
    const r = await saveFathomSettings({ settings: auto });
    expect(r.ok && r.message).toContain("Importar");
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
    expect((db.writesTo("oauth_connections")[0].values as { fathom_settings: { auto_since: string } }).fathom_settings.auto_since).toBeTruthy();
  });

  it("Sincronizar ahora, en manual, explica por que no", async () => {
    guards.getPermissionAction.mockResolvedValue(ME);
    server.service = fakeDb({ "oauth_connections:select": { data: { id: OTHER, status: "active", fathom_settings: { mode: "manual" } } } }).client;
    const r = await syncFathomNow();
    expect(r.ok === false && r.error).toContain("manual");
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
  });
});
