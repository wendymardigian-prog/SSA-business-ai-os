import { describe, expect, it } from "vitest";
import { visibleModuleWords, visibleStrings } from "./visible-strings.mjs";

type Found = { line: number; text: string };

describe("textos visibles de un archivo", () => {
  it("toma strings, template literals y texto de JSX; no comentarios, imports, console ni claves", () => {
    const source = [
      'import { x } from "@/lib/formularios";',
      "// un comentario sobre formularios",
      "const a = { formularios: 1, label: \"Ver formularios\" };",
      'console.error("[formularios] no pude leer");',
      "const b = `Hola ${nombre}, tu pago`;",
      "export const C = () => <p>Las ventas del mes</p>;",
    ].join("\n");
    const texts = (visibleStrings(source, "x.tsx") as Found[]).map((s) => s.text);
    expect(texts).toContain("Ver formularios");
    expect(texts).toContain(", tu pago");
    expect(texts).toContain("Las ventas del mes");
    expect(texts.join(" ")).not.toContain("no pude leer");
    expect(texts.join(" ")).not.toContain("@/lib/formularios");
    expect(texts.join(" ")).not.toContain("un comentario");
  });

  it("devuelve la linea de cada texto", () => {
    const found = visibleStrings('const a = 1;\nconst b = "Formulario";', "x.ts") as Found[];
    expect(found).toEqual([{ line: 2, text: "Formulario" }]);
  });
});

describe("menciones de modulos que no viajan", () => {
  it("encuentra el modulo de cada palabra", () => {
    const hits = visibleModuleWords("Lo que ven los leads en formularios y contratos", "components/x.tsx") as { module: string }[];
    expect(hits.map((h) => h.module)).toEqual(["formularios", "formularios"]);
  });

  it("las excepciones explicadas no cuentan", () => {
    expect(visibleModuleWords("Administrar las tareas de IA", "lib/x.ts")).toEqual([]);
    expect(visibleModuleWords("Respuestas del formulario", "components/scheduling/bookings/detail-panel.tsx")).toEqual([]);
    expect(visibleModuleWords("Respuestas del formulario", "components/inbox/x.tsx")).toHaveLength(1);
  });

  it("el gasto de la pauta o de IA no es Finanzas; los gastos si", () => {
    expect(visibleModuleWords("Gasto del mes", "lib/x.ts")).toEqual([]);
    expect(visibleModuleWords("Gastos vencidos", "lib/x.ts")).toHaveLength(1);
  });
});
