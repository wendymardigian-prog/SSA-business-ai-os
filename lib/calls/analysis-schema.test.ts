import { describe, expect, it } from "vitest";
import { analysisSchema, parseAnalysis } from "./analysis-schema";

const MINIMO = {
  resultado: { categoria: "venta" },
  resumen: "El lead compro.",
  rubrica: [{ codigo: "rapport", nombre: "Rapport", puntaje: 4, justificacion: "Conecto bien" }],
  lead: { perfil: "Dueño de un negocio", creencias: [{ codigo: "urgencia", nombre: "Urgencia", estado: "Firme" }] },
  feedback: { foco: "Preguntar por el decisor", funciono: ["Buen cierre"], mejorar: [{ texto: "Faltó temperatura" }] },
};

describe("esquema del analisis de una llamada", () => {
  it("acepta lo minimo: casi todo lo demas es opcional", () => {
    expect(parseAnalysis(MINIMO).ok).toBe(true);
  });

  it("acepta el analisis completo del SPSP, con los campos extra de la pantalla", () => {
    const full = {
      ...MINIMO,
      resultado: { categoria: "seguimiento_con_fecha", fecha: "2026-10-20", proximo_paso: "Llamar el martes", agendada_en_llamada: true },
      temperatura: 8,
      dolor: { texto: "No tiene leads", categoria: "falta_de_leads", cita: "no me llegan clientes", timestamp: "00:12:30", profundidad: "cuantificado", propuesta: false },
      deseo: { texto: "Duplicar ventas", categoria: "crecer" },
      objecion: { dijo: "Es caro", de_fondo: "no confia", categoria: "precio", cita: "es mucha plata", respondida: true, resuelta: false },
      razon_compra: { texto: "Urgencia", categoria: "urgencia" },
      razon_no_compra: { texto: "Miedo", categoria: "miedo" },
      momento_quiebre: { descripcion: "Al decir el precio", cita: "uf", timestamp: "00:40:00", frase_sugerida: "¿Cómo lo ves?" },
      lead: { ...MINIMO.lead, dolores: ["a"], deseos: ["b"], objeciones: ["c"], detonante: "x", intentos_previos: "y", quien_decide: "el", como_llego: "instagram" },
      alertas: [{ tipo: "precio_sin_temperatura", texto: "No chequeo" }],
    };
    expect(parseAnalysis(full).ok).toBe(true);
  });

  it("un puntaje fuera de 1 a 5 se rechaza", () => {
    const bad = { ...MINIMO, rubrica: [{ ...MINIMO.rubrica[0], puntaje: 7 }] };
    const r = parseAnalysis(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("rubrica");
  });

  it("sin rubrica o sin resumen se rechaza, nombrando el campo", () => {
    const { rubrica: _r, ...sinRubrica } = MINIMO;
    void _r;
    const r1 = parseAnalysis(sinRubrica);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain("rubrica");
    const r2 = parseAnalysis({ ...MINIMO, resumen: undefined });
    expect(r2.ok).toBe(false);
  });

  it("no pide puntajes finales: los calcula el codigo", () => {
    expect(Object.keys(analysisSchema.shape)).not.toContain("closer_score");
    expect(Object.keys(analysisSchema.shape)).not.toContain("lead_score");
  });

  it("el resultado y el estado de las creencias tienen valores cerrados", () => {
    expect(parseAnalysis({ ...MINIMO, resultado: { categoria: "se_vendio_todo" } }).ok).toBe(false);
    const lead = { ...MINIMO.lead, creencias: [{ codigo: "u", nombre: "U", estado: "Quizás" }] };
    expect(parseAnalysis({ ...MINIMO, lead }).ok).toBe(false);
  });

  it("los textos y las citas pueden venir vacios", () => {
    const vacio = { ...MINIMO, resumen: "", rubrica: [{ ...MINIMO.rubrica[0], cita: "", justificacion: "" }] };
    expect(parseAnalysis(vacio).ok).toBe(true);
  });

  it("la temperatura tiene que estar entre 1 y 10, entera", () => {
    expect(parseAnalysis({ ...MINIMO, temperatura: 7.5 }).ok).toBe(false);
    expect(parseAnalysis({ ...MINIMO, temperatura: 11 }).ok).toBe(false);
    expect(parseAnalysis({ ...MINIMO, temperatura: 0 }).ok).toBe(false);
  });
});
