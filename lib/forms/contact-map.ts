/**
 * "Se guarda en el contacto" (plano formularios-ui, F11 y F12). Una sola regla para el panel de la pregunta y la
 * tabla de la pestaña Contacto: son el mismo dato (`contactConfig.map`).
 */
import { targetLabel, targetsFor, type ContactConfig, type CustomFieldDef } from "./contact-config";
import type { FormField } from "./fields";

export interface SetMappingResult {
  config: ContactConfig;
  /** La pregunta a la que se le saco el dato para dárselo a esta (un dato del contacto lo usa una sola pregunta). */
  displaced: { fieldKey: string; label: string } | null;
  /** El destino no sirve para el tipo de esta pregunta (o la pregunta no existe): no se cambio nada. */
  error?: string;
}

/**
 * Mapea la pregunta `fieldKey` al dato `target` del contacto (`null` o "" = no se guarda en el contacto).
 * Si otra pregunta ya usaba ese dato, se lo saca y lo dice en `displaced` (para avisar con un aviso).
 */
export function setFieldMapping(
  config: ContactConfig,
  fields: FormField[],
  customFields: CustomFieldDef[],
  fieldKey: string,
  target: string | null,
): SetMappingResult {
  const field = fields.find((f) => f.key === fieldKey);
  if (!field) return { config, displaced: null, error: "No encontré esa pregunta" };

  const without = config.map.filter((m) => m.fieldKey !== fieldKey);
  if (!target) {
    return { config: without.length === config.map.length ? config : { ...config, map: without }, displaced: null };
  }

  if (!targetsFor(field, customFields).some((t) => t.value === target)) {
    return { config, displaced: null, error: `Esta pregunta no se puede guardar en "${targetLabel(target, customFields)}"` };
  }

  // Si el dato ya era de otra pregunta VIVA, se lo saca. Un mapeo viejo a una pregunta que ya no existe se descarta sin avisar.
  const holder = without.find((m) => m.target === target);
  const holderField = holder ? fields.find((f) => f.key === holder.fieldKey) : undefined;
  const map = [...without.filter((m) => m.target !== target), { fieldKey, target }];
  return {
    config: { ...config, map },
    displaced: holderField ? { fieldKey: holderField.key, label: holderField.label || holderField.key } : null,
  };
}

/** El dato del contacto al que va una pregunta, o "" si no se guarda. */
export function mappingOf(config: ContactConfig, fieldKey: string): string {
  return config.map.find((m) => m.fieldKey === fieldKey)?.target ?? "";
}
