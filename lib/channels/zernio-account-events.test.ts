/**
 * El aviso de Zernio de una cuenta conectada o desconectada: de que negocio es
 * (por la firma) y que se vuelvan a armar los canales y las cuentas sociales.
 * Nada llama afuera: Zernio, Vault y la sincronizacion de Social estan simulados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getZernioKeyState, listAccounts, syncAccountsAfterChange, backfillInboxConversations, notifyNewChannelAccess } =
  vi.hoisted(() => ({
    getZernioKeyState: vi.fn(),
    listAccounts: vi.fn(),
    syncAccountsAfterChange: vi.fn(),
    backfillInboxConversations: vi.fn(),
    notifyNewChannelAccess: vi.fn(),
  }));

vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioKeyState }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({ accounts: { listAccounts } }) }));
vi.mock("@/lib/social/sync-hook", () => ({ syncAccountsAfterChange }));
vi.mock("@/lib/inbox-sync", () => ({ backfillInboxConversations }));
vi.mock("@/lib/channels/new-channel-access", () => ({ notifyNewChannelAccess }));

import { findWorkspaceForSignedEvent, parseAccountEvent, refreshZernioAccounts } from "./zernio-account-events";

const WS = "ws-1";
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  getZernioKeyState.mockResolvedValue({ state: "present", key: "key-simulada" });
  syncAccountsAfterChange.mockResolvedValue([]);
  backfillInboxConversations.mockResolvedValue({ imported: 0 });
  notifyNewChannelAccess.mockResolvedValue(undefined);
});

describe("parseAccountEvent", () => {
  it("lee el evento y el id de la cuenta", () => {
    expect(
      parseAccountEvent({ id: "e", event: "account.connected", account: { accountId: "zr-2", platform: "instagram" } }),
    ).toEqual({ event: "account.connected", accountId: "zr-2" });
  });

  it("sin id de cuenta sigue siendo un aviso (se relee la lista entera)", () => {
    expect(parseAccountEvent({ event: "account.disconnected" })).toEqual({ event: "account.disconnected", accountId: null });
  });

  it("otro evento no es un aviso de cuenta", () => {
    expect(parseAccountEvent({ event: "message.received" })).toBeNull();
    expect(parseAccountEvent(null)).toBeNull();
  });
});

describe("findWorkspaceForSignedEvent", () => {
  const secrets: Record<string, string | null> = { "ws-a": "secreto-a", "ws-b": "secreto-b", "ws-c": null };
  const setup = (channels: Array<Record<string, unknown>> = []) =>
    memoryDb(
      { workspaces: [{ id: "ws-a" }, { id: "ws-b" }, { id: "ws-c" }], channels },
      {
        rpc: {
          read_secret: (args) =>
            args.secret_name === "zernio_webhook_secret" ? (secrets[args.workspace_id as string] ?? null) : null,
        },
      },
    );
  const body = JSON.stringify({ id: "e", event: "account.connected", account: { accountId: "zr-nueva" } });

  it("el negocio es el que tiene el secreto que valida la firma", async () => {
    const db = setup();
    expect(await findWorkspaceForSignedEvent(db.client as never, body, sign(body, "secreto-b"), "zr-nueva")).toBe("ws-b");
  });

  it("una firma que no valida con ningun secreto da null (el receptor responde 401)", async () => {
    const db = setup();
    expect(await findWorkspaceForSignedEvent(db.client as never, body, sign(body, "otro"), "zr-nueva")).toBeNull();
  });

  it("sin firma da null sin leer ningun secreto", async () => {
    const db = setup();
    const rpc = vi.spyOn(db.client, "rpc");
    expect(await findWorkspaceForSignedEvent(db.client as never, body, null, "zr-nueva")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("una desconexion prueba primero al dueño del canal de esa cuenta", async () => {
    const db = setup([{ id: "ch-1", workspace_id: "ws-b", late_account_id: "zr-vieja", provider: "zernio" }]);
    const rpc = vi.spyOn(db.client, "rpc");

    const found = await findWorkspaceForSignedEvent(db.client as never, body, sign(body, "secreto-b"), "zr-vieja");

    expect(found).toBe("ws-b");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("refreshZernioAccounts", () => {
  const setup = () =>
    memoryDb({
      channels: [
        { id: "ch-1", workspace_id: WS, platform: "instagram", provider: "zernio", late_account_id: "zr-ig-1", username: "marca", display_name: "marca", profile_picture: null, is_active: true },
      ],
    });

  it("una segunda Instagram conectada: crea su canal, trae sus conversaciones y sincroniza Social", async () => {
    const db = setup();
    listAccounts.mockResolvedValue({
      data: {
        accounts: [
          { _id: "zr-ig-1", platform: "instagram", username: "marca" },
          { _id: "zr-ig-2", platform: "instagram", username: "academia" },
        ],
      },
    });

    await refreshZernioAccounts(db.client as never, WS, "webhook account.connected");

    const nuevo = db.rows("channels").find((r) => r.late_account_id === "zr-ig-2");
    expect(nuevo).toMatchObject({ workspace_id: WS, is_active: true, username: "academia" });
    expect(backfillInboxConversations).toHaveBeenCalledTimes(1);
    expect(backfillInboxConversations.mock.calls[0][0].channels).toEqual([
      { id: nuevo!.id, late_account_id: "zr-ig-2", platform: "instagram" },
    ]);
    expect(syncAccountsAfterChange).toHaveBeenCalledWith(db.client, WS, "webhook account.connected");
  });

  it("si no hay canales nuevos no trae conversaciones", async () => {
    const db = setup();
    listAccounts.mockResolvedValue({ data: { accounts: [{ _id: "zr-ig-1", platform: "instagram", username: "marca" }] } });

    await refreshZernioAccounts(db.client as never, WS, "webhook account.connected");

    expect(backfillInboxConversations).not.toHaveBeenCalled();
    expect(syncAccountsAfterChange).toHaveBeenCalled();
  });

  it("si Zernio no responde NO desactiva la bandeja, y Social sigue su propio camino", async () => {
    const db = setup();
    listAccounts.mockRejectedValue(new Error("red caida"));

    await refreshZernioAccounts(db.client as never, WS, "webhook account.disconnected");

    expect(db.rows("channels")[0].is_active).toBe(true);
    expect(syncAccountsAfterChange).toHaveBeenCalled();
  });

  it("sin clave de Zernio no lee la lista, pero Social marca sus cuentas", async () => {
    const db = setup();
    getZernioKeyState.mockResolvedValue({ state: "absent" });

    await refreshZernioAccounts(db.client as never, WS, "webhook account.disconnected");

    expect(listAccounts).not.toHaveBeenCalled();
    expect(syncAccountsAfterChange).toHaveBeenCalled();
  });

  it("nunca lanza: corre en el after() del receptor", async () => {
    const db = setup();
    getZernioKeyState.mockRejectedValue(new Error("vault caido"));

    await expect(refreshZernioAccounts(db.client as never, WS, "webhook account.connected")).resolves.toBeUndefined();
  });
});
