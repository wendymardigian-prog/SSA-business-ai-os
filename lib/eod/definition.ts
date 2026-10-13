/**
 * Las reglas de publicación de un reporte de fin de día (E3) y cómo se lee una
 * definición de EOD. Puro.
 */
import type { FormDefinition, FormField } from "@/lib/forms/fields";
import type { EodChannel, EodChannelSelector, EodVariant } from "./types";
import { activeChannels } from "./channels";

export const DEFAULT_CHANNEL_SELECTOR: EodChannelSelector = {
  label: "¿Qué canales trabajaste hoy?",
  required: true,
};

/** Lo que falta para poder publicar un EOD. La variante decide si hay canales. */
export function eodPublishChecks(variant: EodVariant | null | undefined): (definition: FormDefinition) => string[] {
  return (definition) => {
    const reasons: string[] = [];
    if (variant === "setter") {
      const active = activeChannels(definition.channels);
      if (!definition.channelSelector) reasons.push("Falta la pregunta de los canales");
      if (active.length === 0) {
        reasons.push("Un reporte de setters necesita al menos un canal activo (pestaña Canales)");
      }
      for (const channel of active) {
        if (channel.fields.length === 0) reasons.push(`El canal "${channel.label}" está activo pero no tiene preguntas`);
      }
    } else if (variant === "general") {
      if ((definition.channels ?? []).length > 0 || definition.channelSelector) {
        reasons.push("Un reporte general no tiene canales");
      }
      if (definition.fields.length === 0) reasons.push("El reporte necesita al menos una pregunta");
    } else {
      reasons.push("Falta la configuración del reporte de fin de día");
    }
    return reasons;
  };
}

/** Las partes de una definición de EOD, con valores seguros si falta algo. */
export function eodParts(definition: Partial<FormDefinition> | null | undefined): {
  fields: FormField[];
  channelSelector: EodChannelSelector | null;
  channels: EodChannel[];
} {
  return {
    fields: Array.isArray(definition?.fields) ? definition.fields : [],
    channelSelector: definition?.channelSelector ?? null,
    channels: Array.isArray(definition?.channels) ? definition.channels : [],
  };
}
