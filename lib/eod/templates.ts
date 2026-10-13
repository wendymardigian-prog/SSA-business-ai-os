/**
 * Con qué nace un reporte de fin de día (E4). El de setters es el de XCRM, que ya
 * se usa: preguntas generales + Instagram, WhatsApp y LinkedIn con seis preguntas.
 */
import { newFieldId, type FormDefinition, type FormField } from "@/lib/forms/fields";
import type { SuccessConfig } from "@/lib/forms/success";
import { catalogChannels } from "./channels";
import { DEFAULT_CHANNEL_SELECTOR } from "./definition";
import type { EodChannel, EodVariant } from "./types";

function numberField(key: string, label: string, opts: { min?: number; max?: number; metricKey?: string; required?: boolean }): FormField {
  return {
    id: newFieldId(),
    key,
    type: "number",
    label,
    required: opts.required ?? true,
    min: opts.min ?? 0,
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    step: 1,
    ...(opts.metricKey ? { metricKey: opts.metricKey } : {}),
  };
}

function longText(key: string, label: string, required = false): FormField {
  return { id: newFieldId(), key, type: "long_text", label, required };
}

/** Las seis preguntas de cada canal de un setter, todas número ≥ 0 y obligatorias. */
export function setterChannelFields(): FormField[] {
  return [
    numberField("conv_inbound", "Nuevas conversaciones inbound", { metricKey: "conv_inbound" }),
    numberField("conv_outbound", "Nuevas conversaciones outbound", { metricKey: "conv_outbound" }),
    numberField("seguimientos", "Seguimientos", { metricKey: "seguimientos" }),
    numberField("respuestas", "Respuestas recibidas", { metricKey: "respuestas" }),
    numberField("links_enviados", "Links enviados", { metricKey: "links_enviados" }),
    numberField("llamadas_agendadas", "Llamadas agendadas", { metricKey: "llamadas_agendadas" }),
  ];
}

export const SETTER_DEFAULT_CHANNELS = ["instagram", "whatsapp", "linkedin"] as const;

export function setterTemplate(): FormDefinition {
  const channels: EodChannel[] = catalogChannels().map((c) =>
    (SETTER_DEFAULT_CHANNELS as readonly string[]).includes(c.key)
      ? { ...c, enabled: true, fields: setterChannelFields() }
      : c,
  );
  return {
    fields: [
      numberField("horas_trabajadas", "Horas trabajadas hoy", { min: 0, max: 24, metricKey: "horas_trabajadas" }),
      numberField("rendimiento", "Calificación de tu rendimiento general (1 a 10)", { min: 1, max: 10, metricKey: "rendimiento" }),
      longText("mejor_conversacion", "Mejor conversación del día"),
      longText("mejorar_rendimiento", "¿Qué puede hacer el equipo o la empresa para mejorar tu rendimiento?"),
    ],
    channelSelector: { ...DEFAULT_CHANNEL_SELECTOR },
    channels,
  };
}

export function generalTemplate(): FormDefinition {
  return {
    fields: [longText("logros", "¿Qué lograste hoy?"), longText("bloqueos", "¿Qué te frenó?")],
  };
}

export function eodTemplate(variant: EodVariant): FormDefinition {
  return variant === "setter" ? setterTemplate() : generalTemplate();
}

export const EOD_SUCCESS: SuccessConfig = {
  mode: "message",
  title: "¡Reporte enviado!",
  body: "Gracias por completar tu reporte del día.",
};
