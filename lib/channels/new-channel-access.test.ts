import { describe, expect, it } from "vitest";
import { newChannelNotice, rolesWithoutNewChannel } from "./new-channel-access";
import { linkFor } from "@/lib/notifications/types";

describe("una cuenta recien conectada (00249)", () => {
  it("solo los roles que eligen cuenta por cuenta se quedan sin verla", () => {
    expect(
      rolesWithoutNewChannel([
        { name: "Setter", permissions: { channels: { mode: "all", all: { scope: "own", reply: true } } } },
        { name: "Soporte IG", permissions: { channels: { mode: "custom", byChannel: {} } } },
        // Sin bandeja guardada cuenta como "por cuenta" (no ve ninguna): tambien se avisa.
        { name: "Contenido", permissions: { keys: [] } },
      ]),
    ).toEqual(["Soporte IG", "Contenido"]);
  });

  it("el aviso nombra a los roles (hasta tres) y dice donde se arregla", () => {
    const uno = newChannelNotice("@marca", ["Soporte IG"]);
    expect(uno.title).toBe("Conectaste @marca: ningún rol personalizado la ve todavía");
    expect(uno.body).toContain("El rol «Soporte IG» elige cuenta por cuenta, así que no ve esta.");
    expect(uno.body).toContain("Ajustes → Roles");
    const muchos = newChannelNotice("@marca", ["A", "B", "C", "D", "E"]);
    expect(muchos.body).toContain("Los roles «A», «B», «C» y 2 más eligen cuenta por cuenta, así que no ven esta.");
  });

  it("el link del aviso lleva a Roles; los demas avisos de canal siguen yendo a Canales", () => {
    expect(linkFor("channel", "ch-1", { target: "roles" })).toBe("/dashboard/settings/roles");
    expect(linkFor("channel", "ch-1", {})).toBe("/dashboard/channels");
  });
});
