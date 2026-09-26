/**
 * La Graph API de Meta: URLs, errores e insights (F40, F43).
 */

import { describe, it, expect, vi } from "vitest";
import {
  breakdownInsight,
  graphGet,
  graphUrl,
  humanizeGraphError,
  isTransientGraphError,
  pagesWithInstagram,
  seriesInsight,
  sumInsight,
} from "./graph";

describe("armar la URL (F40)", () => {
  it("el token va escapado y los vacios no viajan", () => {
    const url = graphUrl("me/accounts", "tok en+/", { fields: "id", limit: 100, vacio: "" });

    expect(url).toContain("fields=id");
    expect(url).toContain("limit=100");
    expect(url).not.toContain("vacio");
    // Escapado de verdad: el valor crudo no aparece, y al leerlo de vuelta
    // es el mismo. Un token con un "+" sin escapar llega como un espacio.
    expect(url).not.toContain("tok en+/");
    expect(new URL(url).searchParams.get("access_token")).toBe("tok en+/");
  });
});

describe("pedirle al grafo (F40)", () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;

  it("un error del cuerpo vuelve como resultado, no como excepcion", async () => {
    // Meta contesta 200 con un error adentro para cosas que no son fallas.
    const result = await graphGet("me", "t", {}, respond({ error: { code: 100, message: "nope" } }));

    expect(result).toMatchObject({ ok: false, error: { code: 100 } });
  });

  it("un 500 tambien vuelve como resultado", async () => {
    const result = await graphGet("me", "t", {}, respond({}, 500));

    expect(result.ok).toBe(false);
  });

  it("una caida de red tampoco lanza", async () => {
    const impl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const result = await graphGet("me", "t", {}, impl);

    expect(result).toMatchObject({ ok: false });
  });
});

describe("que error es (F40)", () => {
  it("los limites de uso son temporales: el token esta bien", () => {
    // Decir "revisá el token" cuando el token esta perfecto manda a la
    // persona a buscar un problema que no existe.
    expect(isTransientGraphError({ code: 17 })).toBe(true);
    expect(isTransientGraphError({ code: 80004 })).toBe(true);
    expect(humanizeGraphError({ code: 17 })).toContain("volumen");
  });

  it("un token invalido es permanente y dice que hacer", () => {
    expect(isTransientGraphError({ code: 190 })).toBe(false);
    expect(humanizeGraphError({ code: 190 })).toContain("Business Manager");
  });

  it("un permiso faltante nombra el permiso", () => {
    expect(humanizeGraphError({ code: 200 })).toContain("ads_read");
  });
});

describe("paginas con Instagram (F40)", () => {
  it("se quedan solo las que tienen cuenta profesional", () => {
    const candidates = pagesWithInstagram([
      { id: "p1", name: "Sin IG" },
      { id: "p2", name: "Con IG", instagram_business_account: { id: "ig-1", username: "mia" } },
    ]);

    expect(candidates).toEqual([{ id: "p2", name: "Con IG", igId: "ig-1", igUsername: "mia" }]);
  });
});

describe("leer insights (F40, F43)", () => {
  const nodes = [
    { name: "reach", values: [{ value: 10, end_time: "2026-10-01T07:00:00+0000" }, { value: 5, end_time: "2026-10-02T07:00:00+0000" }] },
    { name: "views", total_value: { value: 42 } },
  ];

  it("suma los valores de la serie", () => {
    expect(sumInsight(nodes, "reach")).toBe(15);
  });

  it("prefiere total_value cuando viene", () => {
    expect(sumInsight(nodes, "views")).toBe(42);
  });

  it("un metric que no vino da null, no cero", () => {
    // Escribir un cero que Meta no dijo es inventar un dato: el dashboard lo
    // leeria como "ese dia no paso nada".
    expect(sumInsight(nodes, "saves")).toBeNull();
    expect(sumInsight(undefined, "reach")).toBeNull();
  });

  it("la serie sale con la fecha de cada dia", () => {
    expect(seriesInsight(nodes, "reach")).toEqual([
      { date: "2026-10-01", value: 10 },
      { date: "2026-10-02", value: 5 },
    ]);
  });

  it("el desglose entiende el formato nuevo y el viejo", () => {
    // Cuando Meta vuelva a cambiar, esto sigue andando.
    const nuevo = [
      {
        name: "audience_city",
        total_value: {
          breakdowns: [{ results: [{ dimension_values: ["Buenos Aires"], value: 120 }] }],
        },
      },
    ];
    const viejo = [{ name: "audience_city", values: [{ value: { "Buenos Aires": 120 } }] }];

    expect(breakdownInsight(nuevo, "audience_city")).toEqual({ "Buenos Aires": 120 });
    expect(breakdownInsight(viejo, "audience_city")).toEqual({ "Buenos Aires": 120 });
  });

  it("sin desglose devuelve un objeto vacio", () => {
    expect(breakdownInsight(nodes, "audience_city")).toEqual({});
  });
});
