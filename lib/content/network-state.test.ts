import { describe, expect, it } from "vitest";
import {
  countNetworkStates,
  effectiveAuto,
  networkStateOf,
  networkSummaryText,
  type NetworkPublication,
} from "./network-state";
import { connectedPlatforms, isNetworkConnected } from "./connection";

const AT = "2026-10-15T16:00:00.000Z";
const pub = (over: Partial<NetworkPublication>): NetworkPublication => ({
  platform: "instagram",
  status: "scheduled",
  scheduledAt: AT,
  ...over,
});

describe("C3 · los cinco estados de una red", () => {
  it("sin fecha y sin fila: Sin fecha", () => {
    expect(networkStateOf({ plannedAt: null, publication: undefined, connected: true }).id).toBe("none");
  });

  it("con fecha y nada en la cola: Fecha tentativa", () => {
    const s = networkStateOf({ plannedAt: AT, publication: undefined, connected: true });
    expect(s).toMatchObject({ id: "tent", label: "Fecha tentativa", at: AT });
  });

  it("con una fila en la cola: Programado", () => {
    for (const status of ["scheduled", "uploading"] as const) {
      expect(networkStateOf({ plannedAt: AT, publication: pub({ status }), connected: true }).id).toBe("sched");
    }
  });

  it("saliendo en este momento sigue siendo programado, con su nombre", () => {
    const s = networkStateOf({ plannedAt: AT, publication: pub({ status: "publishing" }), connected: true });
    expect(s).toMatchObject({ id: "sched", label: "Publicando" });
  });

  it("la red confirmo: Publicado", () => {
    const s = networkStateOf({
      plannedAt: AT,
      publication: pub({ status: "published", publishedAt: "2026-10-15T16:02:00.000Z", origin: "system" }),
      connected: true,
    });
    expect(s).toMatchObject({ id: "pub", label: "Publicado", manual: false, at: "2026-10-15T16:02:00.000Z" });
  });

  it("marcado a mano: Publicado a mano", () => {
    const s = networkStateOf({
      plannedAt: null,
      publication: pub({ status: "published", origin: "manual", scheduledAt: null, publishedAt: AT }),
      connected: false,
    });
    expect(s).toMatchObject({ id: "pub", label: "Publicado a mano", manual: true });
  });

  it("fallo: Falló", () => {
    expect(networkStateOf({ plannedAt: AT, publication: pub({ status: "failed" }), connected: true }).id).toBe("fail");
  });

  it("desprogramada: vuelve a la fecha de la pieza (tentativa)", () => {
    const s = networkStateOf({ plannedAt: AT, publication: pub({ status: "cancelled" }), connected: true });
    expect(s.id).toBe("tent");
  });

  it("una red NO conectada con fecha es tentativa, nunca programada", () => {
    const sinFila = networkStateOf({ plannedAt: AT, publication: undefined, connected: false });
    const conFila = networkStateOf({ plannedAt: AT, publication: pub({ status: "scheduled" }), connected: false });
    expect(sinFila.id).toBe("tent");
    expect(conFila.id).toBe("tent");
  });
});

describe("C3 · las transiciones de una red", () => {
  const recorrido: Array<[string, Partial<NetworkPublication> | undefined, string | null, string]> = [
    ["sin nada", undefined, null, "none"],
    ["le pongo fecha", undefined, AT, "tent"],
    ["el sistema la publica", { status: "uploading" }, AT, "sched"],
    ["Zernio la agenda", { status: "scheduled" }, AT, "sched"],
    ["la paso a 'la subo yo'", { status: "cancelled" }, AT, "tent"],
    ["la subo y la marco", { status: "published", origin: "manual" }, AT, "pub"],
  ];
  for (const [paso, fila, fecha, esperado] of recorrido) {
    it(`${paso} → ${esperado}`, () => {
      const s = networkStateOf({ plannedAt: fecha, publication: fila ? pub(fila) : undefined, connected: true });
      expect(s.id).toBe(esperado);
    });
  }
});

describe("C2 · lo que pidio la persona", () => {
  it("auto guardado manda", () => {
    expect(effectiveAuto({ auto: false }, pub({ status: "scheduled" }))).toBe(false);
    expect(effectiveAuto({ auto: true }, undefined)).toBe(true);
  });

  it("sin auto (piezas de antes de v4): programada si hay fila en la cola, si no la subo yo", () => {
    expect(effectiveAuto({}, pub({ status: "scheduled" }))).toBe(true);
    expect(effectiveAuto({}, pub({ status: "cancelled" }))).toBe(false);
    expect(effectiveAuto({}, undefined)).toBe(false);
  });
});

describe("C8 · el resumen del pie", () => {
  it("una programada y dos tentativas", () => {
    const states = [{ id: "sched" as const }, { id: "tent" as const }, { id: "tent" as const }];
    expect(networkSummaryText(states)).toBe("1 programada · 2 tentativas · 0 publicadas");
    expect(countNetworkStates(states)).toEqual({ scheduled: 1, tentative: 2, published: 0 });
  });

  it("en plural y singular", () => {
    expect(networkSummaryText([{ id: "pub" }, { id: "pub" }, { id: "sched" }, { id: "sched" }, { id: "tent" }])).toBe(
      "2 programadas · 1 tentativa · 2 publicadas",
    );
  });

  it("sin redes lo dice", () => {
    expect(networkSummaryText([])).toBe("Todavía no elegiste ninguna red");
  });
});

describe("C1 · que red esta conectada", () => {
  it("cuenta activa con publicador usable", () => {
    const accounts = [
      { platform: "instagram", is_active: true, default_publisher: "zernio" },
      { platform: "tiktok", is_active: true, default_publisher: null },
      { platform: "youtube", is_active: false, default_publisher: "postproxy" },
    ];
    expect(isNetworkConnected("instagram", accounts)).toBe(true);
    // Zernio desconectado deja la cuenta activa pero sin publicador.
    expect(isNetworkConnected("tiktok", accounts)).toBe(false);
    expect(isNetworkConnected("youtube", accounts)).toBe(false);
    expect(isNetworkConnected("linkedin", accounts)).toBe(false);
    expect(connectedPlatforms(accounts)).toEqual(["instagram"]);
  });

  it("sin ninguna cuenta no hay nada conectado", () => {
    expect(connectedPlatforms([])).toEqual([]);
  });
});
