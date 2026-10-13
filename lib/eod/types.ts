/**
 * Las formas propias de un reporte de fin de día (EOD). Solo tipos: lo importan
 * `lib/forms/fields.ts` (la definición) y los módulos puros de `lib/eod/`.
 */
import type { FormField } from "@/lib/forms/fields";

/** La pregunta "¿Qué canales trabajaste hoy?" de un EOD de setters. */
export interface EodChannelSelector {
  label: string;
  required: boolean;
}

/**
 * Un canal de un EOD de setters, con sus propias preguntas. Desactivarlo NO borra
 * sus preguntas: se ocultan y vuelven si se lo activa de nuevo. La clave de una
 * pregunta es única DENTRO de su canal (dos canales pueden tener `links_enviados`).
 */
export interface EodChannel {
  key: string;
  label: string;
  custom: boolean;
  enabled: boolean;
  fields: FormField[];
}

export type EodVariant = "setter" | "general";
