import { describe, expect, it } from "vitest";
import { findMarkers, hasMarkers, MarkerError, parseMarkers, stripMarkers } from "./markers.mjs";

// Las marcas se arman por partes: asi este archivo no tiene marcas "de verdad".
const P = "@plantilla-";
const q = (mods: string) => `// ${P}quitar(${mods})`;
const desde = (mods: string, jsx = false) => (jsx ? `{/* ${P}desde(${mods}) */}` : `// ${P}desde(${mods})`);
const hasta = (mods: string, jsx = false) => (jsx ? `{/* ${P}hasta(${mods}) */}` : `// ${P}hasta(${mods})`);
const KNOWN = ["ventas", "tareas", "formularios"];

describe("stripMarkers", () => {
  it("sin marcas, devuelve el mismo texto", () => {
    const t = "a\nb\n";
    expect(stripMarkers(t, ["ventas"])).toBe(t);
  });

  it("saca una linea marcada si se excluye alguno de sus modulos", () => {
    const t = ["import a from 'a';", `import v from 'v'; ${q("ventas,tareas")}`, "x();"].join("\n");
    expect(stripMarkers(t, ["tareas"])).toBe("import a from 'a';\nx();");
    expect(stripMarkers(t, ["formularios"])).toBe(t);
  });

  it("una marca de linea sola en su linea saca solo esa linea", () => {
    const t = [q("ventas"), "sigue();"].join("\n");
    expect(stripMarkers(t, ["ventas"])).toBe("sigue();");
  });

  it("saca un bloque con sus marcas", () => {
    const t = ["a", desde("ventas"), "b", "c", hasta("ventas"), "d"].join("\n");
    expect(stripMarkers(t, ["ventas"])).toBe("a\nd");
    expect(stripMarkers(t, ["tareas"])).toBe(t);
  });

  it("bloques en JSX y en SQL", () => {
    const jsx = ["<div>", desde("tareas", true), "<Tareas />", hasta("tareas", true), "</div>"].join("\n");
    expect(stripMarkers(jsx, ["tareas"])).toBe("<div>\n</div>");
    const sql = ["select 1;", `-- ${P}desde(ventas)`, "select 2;", `-- ${P}hasta(ventas)`].join("\n");
    expect(stripMarkers(sql, ["ventas"])).toBe("select 1;");
  });

  it("un bloque con varios modulos se va si se excluye cualquiera", () => {
    const t = ["a", desde("ventas, tareas"), "b", hasta("tareas,ventas"), "c"].join("\n");
    expect(stripMarkers(t, ["tareas"])).toBe("a\nc");
  });

  it("una linea marcada adentro de un bloque que se queda se evalua sola", () => {
    const t = [desde("ventas"), `x(); ${q("tareas")}`, "y();", hasta("ventas")].join("\n");
    expect(stripMarkers(t, ["tareas"])).toBe([desde("ventas"), "y();", hasta("ventas")].join("\n"));
  });

  it("la forma 'sin' aparece solo cuando se excluye el modulo", () => {
    const t = ["  // " + P + "sin(ventas): const cols = [];", "fin();"].join("\n");
    expect(stripMarkers(t, ["ventas"])).toBe("  const cols = [];\nfin();");
    expect(stripMarkers(t, ["tareas"])).toBe(t);
  });

  it("valida los modulos si se le pasa la lista", () => {
    const t = `x(); ${q("ventaz")}`;
    expect(() => stripMarkers(t, ["ventas"], KNOWN)).toThrow(/modulo desconocido "ventaz"/);
    expect(() => stripMarkers(t, ["ventas"])).not.toThrow();
  });
});

describe("validacion", () => {
  it("bloque sin cerrar", () => {
    expect(() => parseMarkers([desde("ventas"), "a"].join("\n"))).toThrow(MarkerError);
  });
  it("hasta sin desde", () => {
    expect(() => parseMarkers(["a", hasta("ventas")].join("\n"))).toThrow(/sin su/);
  });
  it("bloques anidados", () => {
    const t = [desde("ventas"), desde("tareas"), hasta("tareas"), hasta("ventas")].join("\n");
    expect(() => parseMarkers(t)).toThrow(/anidado/);
  });
  it("hasta que no coincide", () => {
    expect(() => parseMarkers([desde("ventas"), hasta("tareas")].join("\n"))).toThrow(/no coincide/);
  });
  it("marca mal escrita", () => {
    expect(() => parseMarkers(`x(); // ${P}quitar`)).toThrow(/mal escrita/);
    expect(() => parseMarkers(`x(); // ${P}quitar()`)).toThrow(/mal escrita/);
  });
  it("informa la linea", () => {
    try {
      parseMarkers(["a", "b", hasta("ventas")].join("\n"));
      throw new Error("no lanzo");
    } catch (e) {
      expect((e as { line: number }).line).toBe(3);
    }
  });
});

describe("findMarkers / hasMarkers", () => {
  it("lista modulo y linea de cada marca", () => {
    const t = ["a", `b ${q("ventas,tareas")}`, desde("formularios"), "c", hasta("formularios")].join("\n");
    expect(findMarkers(t)).toEqual([
      { module: "ventas", line: 2, kind: "quitar" },
      { module: "tareas", line: 2, kind: "quitar" },
      { module: "formularios", line: 3, kind: "desde" },
      { module: "formularios", line: 5, kind: "hasta" },
    ]);
    expect(hasMarkers(t)).toBe(true);
    expect(hasMarkers("nada")).toBe(false);
  });
});
