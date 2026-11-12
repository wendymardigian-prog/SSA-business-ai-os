// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import {
  buildClientRows,
  clientQuickOptions,
  groupClients,
  matchesClientQuick,
  parseClientsUrl,
  portalGroupOf,
  searchClients,
  serializeClientsUrl,
  sortClients,
  worstLight,
  type ClientServiceInput,
} from "./clients-list";

const NOW = "2026-11-10T12:00:00Z";
const svc = (contactId: string, over: Partial<ClientServiceInput> = {}): ClientServiceInput => ({ contactId, status: "active", light: "green", progressPct: 50, ownerName: "Persona A", hasPortal: true, ...over });

describe("worstLight", () => {
  it("el peor de los activos; por confirmar aparte", () => {
    expect(worstLight([svc("a", { light: "green" }), svc("a", { light: "red" }), svc("a", { light: "yellow" })])).toBe("red");
    expect(worstLight([svc("a", { status: "completed", light: "red" }), svc("a", { light: "yellow" })])).toBe("yellow");
    expect(worstLight([svc("a", { status: "pending_confirmation", light: null })])).toBe("pending");
    expect(worstLight([svc("a", { status: "completed" })])).toBe("none");
    expect(worstLight([svc("a", { light: null })])).toBe("gray");
  });
});

describe("portalGroupOf", () => {
  it("entró esta semana, más de 7 días, invitada sin entrar, sin portal", () => {
    expect(portalGroupOf(true, { accountStatus: "active", lastLoginAt: "2026-11-08T10:00:00Z", pendingReviews: 0 }, NOW)).toBe("week");
    expect(portalGroupOf(true, { accountStatus: "active", lastLoginAt: "2026-10-20T10:00:00Z", pendingReviews: 0 }, NOW)).toBe("stale");
    expect(portalGroupOf(true, { accountStatus: "invited", lastLoginAt: null, pendingReviews: 0 }, NOW)).toBe("invited");
    expect(portalGroupOf(true, { accountStatus: "active", lastLoginAt: null, pendingReviews: 0 }, NOW)).toBe("never");
    expect(portalGroupOf(true, null, NOW)).toBe("none");
    expect(portalGroupOf(false, { accountStatus: "active", lastLoginAt: NOW, pendingReviews: 0 }, NOW)).toBe("none");
  });
});

const rows = buildClientRows({
  services: [
    svc("a", { light: "yellow", progressPct: 40 }),
    svc("a", { light: "green", progressPct: 80, ownerName: "Persona B" }),
    svc("b", { light: "red", progressPct: 10 }),
    svc("c", { status: "pending_confirmation", light: null, ownerName: null }),
    svc("d", { status: "active", light: "green", hasPortal: false }),
  ],
  names: new Map([
    ["a", "Ana"],
    ["b", "Bruno"],
    ["c", "Carla"],
    ["d", "Dario"],
  ]),
  portal: new Map([
    ["a", { accountStatus: "active", lastLoginAt: "2026-11-09T10:00:00Z", pendingReviews: 1 }],
    ["b", { accountStatus: "active", lastLoginAt: "2026-10-01T10:00:00Z", pendingReviews: 2 }],
    ["d", { accountStatus: "active", lastLoginAt: "2026-11-09T10:00:00Z", pendingReviews: 5 }],
  ]),
  paidCents: new Map([
    ["a", 310000],
    ["b", 80000],
  ]),
  nowIso: NOW,
});

describe("buildClientRows", () => {
  it("una fila por contacto, con lo que pide la tabla", () => {
    const a = rows.find((r) => r.contactId === "a")!;
    expect(a).toMatchObject({ name: "Ana", light: "yellow", pendingReviews: 1, activeCount: 2, progressPct: 60, owners: ["Persona A", "Persona B"], portalGroup: "week", paidCents: 310000 });
    expect(rows.find((r) => r.contactId === "c")).toMatchObject({ light: "pending", activeCount: 0, progressPct: null, paidCents: null });
  });
  it("sin portal no cuenta entregas ni ingreso (no inventa datos del portal)", () => {
    expect(rows.find((r) => r.contactId === "d")).toMatchObject({ hasPortal: false, pendingReviews: 0, lastLoginAt: null, portalGroup: "none" });
  });
});

describe("filtro rápido, búsqueda y orden", () => {
  it("cada opción con su conteo", () => {
    expect(clientQuickOptions(rows).map((o) => [o.key, o.count])).toEqual([
      ["all", 4],
      ["red", 1],
      ["yellow", 1],
      ["pending", 1],
      ["reviews", 2],
      ["stale", 1],
    ]);
    expect(matchesClientQuick(rows[1], "red")).toBe(true);
  });
  it("sin ningún cliente con portal, no se ofrecen las opciones del portal", () => {
    expect(clientQuickOptions(rows.filter((r) => !r.hasPortal)).map((o) => o.key)).toEqual(["all", "red", "yellow", "pending"]);
  });
  it("busca sin tildes ni mayúsculas", () => {
    expect(searchClients([{ ...rows[0], name: "María José" }], "maria").length).toBe(1);
    expect(searchClients(rows, "  ").length).toBe(4);
  });
  it("ordena por cualquier columna; lo que no tiene dato va al final", () => {
    expect(sortClients(rows, "light", "asc").map((r) => r.name)).toEqual(["Bruno", "Ana", "Carla", "Dario"]);
    expect(sortClients(rows, "paid", "desc").map((r) => r.name)).toEqual(["Ana", "Bruno", "Carla", "Dario"]);
    expect(sortClients(rows, "paid", "asc").map((r) => r.name)).toEqual(["Bruno", "Ana", "Carla", "Dario"]);
    expect(sortClients(rows, "name", "desc")[0].name).toBe("Dario");
  });
});

describe("groupClients", () => {
  it("por semáforo, en orden de gravedad; la suma es el total", () => {
    const g = groupClients(rows, "light");
    expect(g.map((x) => x.label)).toEqual(["Rojo", "Amarillo", "Por confirmar", "Verde"]);
    expect(g.reduce((n, x) => n + x.rows.length, 0)).toBe(rows.length);
  });
  it("por portal y por responsable", () => {
    expect(groupClients(rows, "portal").map((x) => x.key)).toEqual(["stale", "week", "none"]);
    const o = groupClients(rows, "owner");
    expect(o.map((x) => x.label)).toEqual(["Persona A", "Persona B", "Sin responsable"]);
  });
});

describe("la URL de la lista", () => {
  it("ida y vuelta, y el link viejo ?vista=tablero", () => {
    const s = parseClientsUrl({ modo: "tablero", f: "red", agrupar: "portal", q: "ana" });
    expect(s).toEqual({ mode: "board", quick: "red", group: "portal", q: "ana" });
    expect(serializeClientsUrl(s)).toBe("modo=tablero&f=red&agrupar=portal&q=ana");
    expect(parseClientsUrl({ vista: "tablero" }).mode).toBe("board");
    expect(parseClientsUrl({ f: "otro", agrupar: "x" })).toEqual({ mode: "table", quick: "all", group: "none", q: "" });
  });
});
