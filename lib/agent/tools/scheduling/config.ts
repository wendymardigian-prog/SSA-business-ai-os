/**
 * La configuración de la habilidad de agendamiento (F52).
 *
 * Es una sola para las siete herramientas: qué eventos puede ofrecer, en qué
 * ventana mirar, y si puede cancelar. Pedir lo mismo siete veces sería siete
 * veces la misma decisión.
 */

import { z } from "zod";
import type { ToolConfigField } from "../types";

export const schedulingSkillSchema = z.object({
  habilitada: z.boolean().default(false),
  /**
   * Qué eventos puede ofrecer. Vacío = ninguno, y la habilidad no se puede
   * prender.
   *
   * No se exige formato de uuid: lo que importa es que el evento exista en
   * este negocio, y eso lo comprueban las herramientas al buscarlo. Un id que
   * no es de acá simplemente nunca encuentra nada.
   */
  event_type_ids: z.array(z.string().min(1)).default([]),
  /** Cuántos días para adelante mirar cuando busca horarios. */
  dias_a_mirar: z.number().int().min(1).max(45).default(14),
  /** Cuántos horarios ofrecer por vez. Más de cinco es una lista, no una propuesta. */
  horarios_por_respuesta: z.number().int().min(2).max(5).default(3),
  /** Si puede agendar de verdad o solo pasar el link. */
  puede_agendar: z.boolean().default(true),
  /** Si puede cancelar y reagendar lo que ya está agendado. */
  puede_cancelar: z.boolean().default(false),
});

export type SchedulingSkillConfig = z.infer<typeof schedulingSkillSchema>;

export const schedulingSkillFields: ToolConfigField[] = [
  {
    key: "event_type_ids",
    label: "Qué puede ofrecer",
    hint: "Solo estos eventos. Si no elegís ninguno, la habilidad no se puede prender.",
    kind: "multiselect",
    optionSource: "event_types",
    requiredForTool: true,
    emptySourceMessage: "Todavía no hay eventos activos. Creá uno en Agenda para poder prender esto.",
  },
  {
    key: "dias_a_mirar",
    label: "Hasta cuántos días adelante busca",
    hint: "Más días es más para elegir, pero también propuestas lejanas que nadie toma.",
    kind: "number",
    min: 1,
    max: 45,
  },
  {
    key: "horarios_por_respuesta",
    label: "Cuántos horarios propone por vez",
    hint: "Dos o tres se contestan; diez se leen como una lista y no se contestan.",
    kind: "number",
    min: 2,
    max: 5,
  },
  {
    key: "puede_agendar",
    label: "Puede agendar",
    hint: "Apagado, ofrece horarios y pasa el link para que agende la persona.",
    kind: "boolean",
  },
  {
    key: "puede_cancelar",
    label: "Puede cancelar y reagendar",
    hint: "Apagado, si le piden cancelar deriva a una persona. Empezá apagado.",
    kind: "boolean",
  },
];

/** La configuración de un agente, ya validada. */
export function schedulingConfigOf(toolsConfig: Record<string, unknown> | null | undefined): SchedulingSkillConfig {
  const raw = (toolsConfig ?? {}).scheduling;
  const parsed = schedulingSkillSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : schedulingSkillSchema.parse({});
}

/** Encendida y con al menos un evento: si no, no tiene nada que ofrecer. */
export function schedulingUsable(config: SchedulingSkillConfig): boolean {
  return config.habilitada && config.event_type_ids.length > 0;
}
