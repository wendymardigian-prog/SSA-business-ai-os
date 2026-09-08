import { describe, it, expect } from "vitest";
import {
  firstParam,
  listParam,
  pickEnum,
  pickIds,
  pickPage,
  sanitizeSearch,
  toggleListParam,
} from "./url-params";

describe("firstParam", () => {
  it("resuelve un parametro repetido al primero", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("devuelve cadena vacia cuando no vino", () => {
    expect(firstParam(undefined)).toBe("");
    expect(firstParam([])).toBe("");
  });

  it("recorta los espacios", () => {
    expect(firstParam("  hola  ")).toBe("hola");
  });
});

describe("listParam", () => {
  it("acepta un valor suelto como lista de uno", () => {
    expect(listParam("a")).toEqual(["a"]);
  });

  it("saca duplicados y vacios", () => {
    expect(listParam(["a", "a", "", "  ", "b"])).toEqual(["a", "b"]);
  });

  it("topea la cantidad de valores", () => {
    const muchos = Array.from({ length: 200 }, (_, i) => `t${i}`);
    expect(listParam(muchos).length).toBe(50);
    expect(listParam(muchos, 3)).toEqual(["t0", "t1", "t2"]);
  });
});

describe("pickEnum", () => {
  const allowed = ["cold", "warm", "hot"] as const;

  it("acepta un valor de la lista", () => {
    expect(pickEnum("warm", allowed)).toBe("warm");
  });

  it("ignora un valor inventado en vez de romper", () => {
    expect(pickEnum("tibio", allowed)).toBe("");
    expect(pickEnum(undefined, allowed)).toBe("");
  });

  it("respeta el fallback cuando se le da uno", () => {
    expect(pickEnum("nada", allowed, "cold")).toBe("cold");
  });
});

describe("pickIds", () => {
  const delWorkspace = new Set(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]);

  it("deja pasar solo los ids que el servidor ya conoce", () => {
    const ids = pickIds(
      ["11111111-1111-1111-1111-111111111111", "99999999-9999-9999-9999-999999999999"],
      delWorkspace,
    );
    expect(ids).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("descarta un id de otro workspace aunque tenga forma de uuid", () => {
    expect(pickIds("33333333-3333-3333-3333-333333333333", delWorkspace)).toEqual([]);
  });

  it("acepta un iterable, no solo un Set", () => {
    expect(pickIds("a", ["a", "b"])).toEqual(["a"]);
  });
});

describe("pickPage", () => {
  it("arranca en 1 cuando no vino o es basura", () => {
    expect(pickPage(undefined)).toBe(1);
    expect(pickPage("hola")).toBe(1);
    expect(pickPage("0")).toBe(1);
    expect(pickPage("-4")).toBe(1);
  });

  it("lee una pagina valida", () => {
    expect(pickPage("7")).toBe(7);
  });

  it("topea para que no se pida una pagina absurda", () => {
    expect(pickPage("999999999")).toBe(100_000);
  });
});

describe("sanitizeSearch", () => {
  it("saca los caracteres que rompen el filtro or de PostgREST", () => {
    expect(sanitizeSearch("juan,perez(*)")).toBe("juan perez");
  });

  it("saca los comodines de ilike", () => {
    expect(sanitizeSearch("%%%")).toBe("");
  });

  it("corta el largo", () => {
    expect(sanitizeSearch("a".repeat(200)).length).toBe(100);
  });
});

describe("toggleListParam", () => {
  it("agrega un valor que no estaba", () => {
    const next = toggleListParam(new URLSearchParams("tag=a"), "tag", "b");
    expect(next.getAll("tag")).toEqual(["a", "b"]);
  });

  it("saca un valor que ya estaba", () => {
    const next = toggleListParam(new URLSearchParams("tag=a&tag=b"), "tag", "a");
    expect(next.getAll("tag")).toEqual(["b"]);
  });

  it("no toca el original ni los otros parametros", () => {
    const original = new URLSearchParams("tag=a&estado=open");
    const next = toggleListParam(original, "tag", "b");
    expect(original.getAll("tag")).toEqual(["a"]);
    expect(next.get("estado")).toBe("open");
  });
});
