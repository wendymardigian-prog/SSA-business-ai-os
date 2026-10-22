/**
 * Los canales de la bandeja que salen de la lista de Zernio. Es lo que hacia la
 * ruta «Sincronizar canales» antes de moverlo a `lib/`: estos casos fijan que se
 * siga comportando igual, ahora que lo usa tambien el aviso `account.connected`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { notifyNewChannelAccess } = vi.hoisted(() => ({ notifyNewChannelAccess: vi.fn() }));
vi.mock("@/lib/channels/new-channel-access", () => ({ notifyNewChannelAccess }));

import { syncZernioChannels } from "./zernio-channels";

const WS = "ws-1";

const channel = (over: Record<string, unknown>) => ({
  workspace_id: WS,
  platform: "instagram",
  provider: "zernio",
  is_active: true,
  username: null,
  display_name: null,
  profile_picture: null,
  ...over,
});

function setup(channels: Array<Record<string, unknown>>) {
  const db = memoryDb({ channels });
  const service = vi.fn(async () => db.client);
  return { db, service, run: (accounts: Array<Record<string, unknown>>) =>
    syncZernioChannels({ supabase: db.client as never, service: service as never, workspaceId: WS, accounts }) };
}

beforeEach(() => {
  notifyNewChannelAccess.mockReset();
  notifyNewChannelAccess.mockResolvedValue(undefined);
});

describe("syncZernioChannels", () => {
  it("una segunda Instagram crea su canal, avisa a Owner y Admin y no toca la primera", async () => {
    const { db, run } = setup([
      channel({ id: "ch-1", late_account_id: "zr-ig-1", username: "marca", display_name: "marca" }),
    ]);

    const result = await run([
      { _id: "zr-ig-1", platform: "instagram", username: "marca" },
      { _id: "zr-ig-2", platform: "instagram", username: "academia", displayName: "Academia" },
    ]);

    const rows = db.rows("channels");
    expect(rows).toHaveLength(2);
    const nuevo = rows.find((r) => r.late_account_id === "zr-ig-2")!;
    expect(nuevo).toMatchObject({ workspace_id: WS, platform: "instagram", provider: "zernio", username: "academia", display_name: "Academia", is_active: true });
    expect(result).toMatchObject({ created: 1, updated: 0, deactivated: 0, skipped: [], failed: [] });
    expect(result.createdChannels).toEqual([{ id: nuevo.id, late_account_id: "zr-ig-2", platform: "instagram" }]);
    expect(notifyNewChannelAccess).toHaveBeenCalledWith(db.client, {
      workspaceId: WS,
      channelId: nuevo.id,
      label: "@academia",
    });
  });

  it("correr dos veces no duplica canales ni avisos", async () => {
    const { db, run } = setup([]);
    const accounts = [{ _id: "zr-ig-1", platform: "instagram", username: "marca" }];

    await run(accounts);
    const second = await run(accounts);

    expect(db.rows("channels")).toHaveLength(1);
    expect(second).toMatchObject({ created: 0, updated: 0, deactivated: 0 });
    expect(notifyNewChannelAccess).toHaveBeenCalledTimes(1);
  });

  it("actualiza el nombre y la foto de un canal que ya estaba", async () => {
    const { db, run } = setup([channel({ id: "ch-1", late_account_id: "zr-ig-1", username: "viejo", display_name: "viejo" })]);

    const result = await run([{ _id: "zr-ig-1", platform: "instagram", username: "nuevo", profilePicture: "https://foto" }]);

    expect(result.updated).toBe(1);
    expect(db.rows("channels")[0]).toMatchObject({ username: "nuevo", display_name: "nuevo", profile_picture: "https://foto" });
  });

  it("desactiva el canal de una cuenta que Zernio ya no lista, sin tocar WhatsApp", async () => {
    const { db, run } = setup([
      channel({ id: "ch-1", late_account_id: "zr-ig-1" }),
      channel({ id: "ch-2", late_account_id: "zr-ig-2" }),
      channel({ id: "ch-wa", provider: "evolution", platform: "whatsapp", late_account_id: "wa-1" }),
    ]);

    const result = await run([{ _id: "zr-ig-1", platform: "instagram" }]);

    expect(result.deactivated).toBe(1);
    expect(db.rows("channels").find((r) => r.id === "ch-2")!.is_active).toBe(false);
    expect(db.rows("channels").find((r) => r.id === "ch-wa")!.is_active).toBe(true);
  });

  it("una red que la bandeja no maneja se saltea y se informa, no se guarda", async () => {
    const { db, run } = setup([]);

    const result = await run([{ _id: "zr-tt", platform: "tiktok" }, { _id: "zr-yt", platform: "youtube" }]);

    expect(db.rows("channels")).toHaveLength(0);
    expect(result.skipped).toEqual(["tiktok", "youtube"]);
  });
});
