import { describe, expect, it } from "vitest";
import { blankItem, cleanFormValue, describeSectionValue, SECTION_FORMS } from "./section-forms";
import { ANALYSIS_SECTIONS } from "./scoring";
import { validateSectionValue } from "./section-edit";

describe("formularios de seccion", () => {
  it("cada seccion editable tiene su formulario (y viceversa)", () => {
    expect(Object.keys(SECTION_FORMS).sort()).toEqual([...ANALYSIS_SECTIONS].sort());
  });

  it("lo que el formulario devuelve pasa la validacion del servidor", () => {
    const samples: Record<string, unknown> = {
      resumen: "  Un resumen  ",
      "lead.perfil": "Perfil",
      "lead.tolerancia": "Tolerancia",
      resultado: { categoria: "venta", fecha: "", proximo_paso: "Llamar", agendada_en_llamada: true },
      momento_quiebre: { descripcion: "Al decir el precio", cita: "", timestamp: "" },
      dolor: { texto: "x", categoria: "leads", profundidad: "mencionado" },
      deseo: { texto: "crecer", categoria: "" },
      objecion: { dijo: "caro", categoria: "precio", respondida: false },
      rubrica: [{ codigo: "a", nombre: "A", puntaje: "4", justificacion: " bien " }],
      "feedback.funciono": ["  a  ", ""],
      "feedback.mejorar": [{ texto: "m", frase_sugerida: "" }],
      "lead.creencias": [{ codigo: "u", nombre: "U", estado: "Firme", evidencia: "" }],
    };
    for (const section of ANALYSIS_SECTIONS) {
      const cleaned = cleanFormValue(section, samples[section]);
      expect(validateSectionValue(section, cleaned), section).toBeNull();
    }
  });

  it("el puntaje vuelve a numero y los vacios se sacan", () => {
    expect(cleanFormValue("rubrica", [{ codigo: "a", puntaje: "4", justificacion: "", cita: " " }])).toEqual([{ codigo: "a", puntaje: 4 }]);
    expect(cleanFormValue("feedback.funciono", ["  a ", "  ", "b"])).toEqual(["a", "b"]);
    expect(cleanFormValue("resumen", "  hola ")).toBe("hola");
  });

  it("una fila nueva de mejoras arranca vacia", () => {
    expect(blankItem("feedback.mejorar")).toEqual({ texto: "", frase_sugerida: "" });
    expect(blankItem("resumen")).toEqual({});
  });
});

describe("describeSectionValue", () => {
  it("texto, lista de textos y objeto", () => {
    expect(describeSectionValue("resumen", "hola")).toBe("hola");
    expect(describeSectionValue("feedback.funciono", ["a", "b"])).toBe("• a\n• b");
    expect(describeSectionValue("resultado", { categoria: "venta", agendada_en_llamada: true })).toBe("Resultado: venta\nQuedó agendado durante la llamada: Sí");
  });
  it("una lista con el nombre de cada fila", () => {
    const text = describeSectionValue("rubrica", [{ codigo: "a", nombre: "Rapport", puntaje: 4, justificacion: "bien" }]);
    expect(text).toContain("Rapport");
    expect(text).toContain("Puntaje (1 a 5): 4");
    expect(text).not.toContain("codigo");
  });
  it("lo vacio se muestra como raya", () => {
    expect(describeSectionValue("resumen", null)).toBe("—");
    expect(describeSectionValue("feedback.mejorar", [])).toBe("—");
  });
});
