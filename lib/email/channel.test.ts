/**
 * El canal de email (F62).
 */

import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import {
  addressFromAccountId,
  emailAccountId,
  ensureEmailChannel,
  findChannelByAddress,
  getEmailChannel,
  normalizeAddress,
  recipientAddress,
} from "./channel";

const WS = "ws-1";

const db = (channels: Array<Record<string, unknown>> = []) =>
  memoryDb(
    { channels },
    {
      unique: {
        channels: (a, b) =>
          a.platform === "email" && b.platform === "email" && a.workspace_id === b.workspace_id,
      },
    },
  );

describe("la direccion en late_account_id (F62)", () => {
  it("va con prefijo: esa columna es NOT NULL en toda la tabla", () => {
    // Aflojar el NOT NULL para un canal obligaria a revisar los 40+ lugares
    // que la leen asumiendo un texto.
    expect(emailAccountId("Hola@Negocio.com")).toBe("email:hola@negocio.com");
    expect(addressFromAccountId("email:hola@negocio.com")).toBe("hola@negocio.com");
  });

  it("un account id de otro canal no devuelve direccion", () => {
    expect(addressFromAccountId("late-account-1")).toBeNull();
  });
});

describe("validar la direccion (F62)", () => {
  it("una valida se normaliza a minusculas", () => {
    expect(normalizeAddress("  Hola@Negocio.COM ")).toBe("hola@negocio.com");
  });

  it("lo que no es una direccion se rechaza", () => {
    expect(normalizeAddress("hola")).toBeNull();
    expect(normalizeAddress("hola@negocio")).toBeNull();
    expect(normalizeAddress("")).toBeNull();
  });
});

describe("crear el canal (F62)", () => {
  it("se crea con la direccion y queda conectado", async () => {
    const memory = db();

    const result = await ensureEmailChannel(memory.client, { workspaceId: WS, address: "hola@x.com" });

    expect(result).toMatchObject({ ok: true, created: true });
    expect(memory.rows("channels")[0]).toMatchObject({
      platform: "email",
      provider: "resend",
      email_address: "hola@x.com",
      late_account_id: "email:hola@x.com",
      is_active: true,
    });
  });

  it("cambiar la direccion MUEVE el canal, no crea otro", async () => {
    // Si creara uno nuevo, las conversaciones viejas quedarian colgando de
    // un canal que ya nadie mira.
    const memory = db([
      {
        id: "ch-1",
        workspace_id: WS,
        platform: "email",
        provider: "resend",
        email_address: "viejo@x.com",
        late_account_id: "email:viejo@x.com",
      },
    ]);

    const result = await ensureEmailChannel(memory.client, { workspaceId: WS, address: "nuevo@x.com" });

    expect(result).toMatchObject({ ok: true, created: false, channelId: "ch-1" });
    expect(memory.rows("channels")).toHaveLength(1);
    expect(memory.rows("channels")[0].email_address).toBe("nuevo@x.com");
  });

  it("una direccion invalida no crea nada", async () => {
    const memory = db();

    expect(await ensureEmailChannel(memory.client, { workspaceId: WS, address: "hola" })).toMatchObject(
      { ok: false },
    );
    expect(memory.rows("channels")).toHaveLength(0);
  });
});

describe("encontrar el canal (F62)", () => {
  const memory = () =>
    db([
      {
        id: "ch-1",
        workspace_id: WS,
        platform: "email",
        email_address: "hola@x.com",
        is_active: true,
      },
    ]);

  it("por workspace", async () => {
    expect(await getEmailChannel(memory().client, WS)).toMatchObject({
      id: "ch-1",
      address: "hola@x.com",
    });
  });

  it("por direccion, sin saber el workspace", async () => {
    // Es lo que hace el receptor: el correo llega y hay que averiguar de
    // quien es.
    expect(await findChannelByAddress(memory().client, "HOLA@X.COM")).toMatchObject({
      id: "ch-1",
      workspaceId: WS,
    });
  });

  it("una direccion que no es nuestra no devuelve nada", async () => {
    expect(await findChannelByAddress(memory().client, "otro@y.com")).toBeNull();
  });

  it("un workspace sin canal de email devuelve null", async () => {
    expect(await getEmailChannel(db().client, WS)).toBeNull();
  });
});

describe("a que direccion nuestra llego (F62)", () => {
  it("la que coincide con un canal, aunque este en copia", () => {
    expect(
      recipientAddress({
        to: ["otro@cliente.com"],
        cc: ["hola@x.com"],
        knownAddresses: ["hola@x.com"],
      }),
    ).toBe("hola@x.com");
  });

  it("si ninguna coincide, la primera de to", () => {
    // En copia oculta la nuestra no aparece: la primera de `to` es lo mas
    // parecido a la verdad.
    expect(recipientAddress({ to: ["Alguien@Cliente.com"], knownAddresses: ["hola@x.com"] })).toBe(
      "alguien@cliente.com",
    );
  });

  it("sin destinatarios, null", () => {
    expect(recipientAddress({ to: [], knownAddresses: [] })).toBeNull();
  });
});
