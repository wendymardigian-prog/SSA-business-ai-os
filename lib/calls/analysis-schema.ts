/**
 * La forma del analisis de una llamada, para `generateObject`.
 *
 * Es el formato de respuesta que en prevxcrm iba escrito dentro del prompt
 * ("Respondé SOLO un JSON con…"). Aca lo manda el esquema: el modelo no puede
 * romper el JSON editando el texto de las instrucciones, y lo que no encaja
 * falla en un solo lugar.
 *
 * Las claves son las del SPSP en castellano (`rubrica`, `lead.creencias`,
 * `alertas`…): son las que lee `scoring.ts` y las que pinta la ficha. Casi todo
 * es `nullish`: un modelo que no tiene evidencia para un campo lo deja vacio, y
 * un campo vacio no puede tirar abajo un analisis de 30 minutos de llamada.
 * Los puntajes finales (closer y lead) NO estan: los calcula el codigo.
 */
import { z } from "zod";
import { MAX_PROPOSALS, proposalActionSchema } from "./proposals";
import { OUTCOME_CATEGORIES } from "./rubric";

/** Los estados de una creencia del lead (los que entiende `beliefValue`). */
export const BELIEF_STATES = ["Firme", "Parcial", "Débil", "No explorado"] as const;

const text = z.string().nullish();
const proposable = { propuesta: z.boolean().nullish() };

export const analysisSchema = z.object({
  resultado: z.object({
    categoria: z.enum(OUTCOME_CATEGORIES),
    fecha: text,
    proximo_paso: text,
    agendada_en_llamada: z.boolean().nullish(),
  }),
  resumen: z.string(),
  temperatura: z.number().int().min(1).max(10).nullish(),
  dolor: z.object({
    texto: z.string(),
    categoria: z.string(),
    cita: text,
    timestamp: text,
    profundidad: z.enum(["mencionado", "profundizado", "cuantificado"]).nullish(),
    ...proposable,
  }).nullish(),
  deseo: z.object({ texto: z.string(), categoria: z.string(), ...proposable }).nullish(),
  objecion: z.object({
    dijo: z.string(),
    de_fondo: text,
    categoria: z.string(),
    cita: text,
    timestamp: text,
    respondida: z.boolean().nullish(),
    resuelta: z.boolean().nullish(),
    ...proposable,
  }).nullish(),
  razon_compra: z.object({ texto: z.string(), categoria: z.string(), ...proposable }).nullish(),
  razon_no_compra: z.object({ texto: z.string(), categoria: z.string(), ...proposable }).nullish(),
  momento_quiebre: z.object({
    descripcion: z.string(),
    cita: text,
    timestamp: text,
    frase_sugerida: text,
  }).nullish(),
  rubrica: z.array(z.object({
    codigo: z.string(),
    nombre: z.string(),
    puntaje: z.number().int().min(1).max(5),
    justificacion: z.string(),
    cita: text,
    timestamp: text,
  })),
  lead: z.object({
    perfil: z.string(),
    tolerancia: text,
    creencias: z.array(z.object({
      codigo: z.string(),
      nombre: z.string(),
      estado: z.enum(BELIEF_STATES),
      evidencia: text,
    })),
    dolores: z.array(z.string()).nullish(),
    deseos: z.array(z.string()).nullish(),
    objeciones: z.array(z.string()).nullish(),
    detonante: text,
    intentos_previos: text,
    quien_decide: text,
    como_llego: text,
  }),
  feedback: z.object({
    foco: z.string(),
    funciono: z.array(z.string()),
    mejorar: z.array(z.object({ texto: z.string(), frase_sugerida: text })),
  }),
  alertas: z.array(z.object({ tipo: z.string(), texto: z.string() })).nullish(),
});

export type CallAnalysis = z.infer<typeof analysisSchema>;

/**
 * El formato general: una reunion que no es de venta (servicio, equipo...). Sin resultado de venta,
 * sin lead ni creencias: por eso no tiene puntaje de lead. Las claves que comparte con el de ventas
 * son las mismas, asi la ficha y las correcciones las leen igual.
 */
export const generalAnalysisSchema = z.object({
  resumen: z.string(),
  rubrica: analysisSchema.shape.rubrica,
  proximos_pasos: z.array(z.string()).nullish(),
  feedback: analysisSchema.shape.feedback,
  alertas: analysisSchema.shape.alertas,
});

export type GeneralCallAnalysis = z.infer<typeof generalAnalysisSchema>;

/**
 * El formato general con las acciones propuestas (Servicios A4, F142): suma `acciones` (hasta 8) SOLO si el analizador
 * tiene «Proponer acciones» prendido. Sin eso, el esquema es exactamente el de siempre.
 */
export function buildGeneralSchema(opts: { proposals: boolean }) {
  if (!opts.proposals) return generalAnalysisSchema;
  return generalAnalysisSchema.extend({ acciones: z.array(proposalActionSchema).max(MAX_PROPOSALS) });
}

/** Las secciones de texto que el resumen y el contacto usan, sin tener que conocer el esquema entero. */
export function parseAnalysis(value: unknown): { ok: true; analysis: CallAnalysis } | { ok: false; error: string } {
  const parsed = analysisSchema.safeParse(value);
  if (parsed.success) return { ok: true, analysis: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, error: `${first?.path.join(".") || "analisis"}: ${first?.message ?? "no valido"}` };
}
