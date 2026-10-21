/**
 * Reglas de publicación propias de cada tipo de formulario (F22, F24).
 * Devuelven los motivos que faltan; `checkPublishable` los suma a los comunes.
 */
import type { FormDefinition, FormType } from "./fields";
import { isScoreType } from "./fields";
import { eodPublishChecks } from "@/lib/eod/definition";
import { parseStoredEodConfig } from "@/lib/eod/config";
import { parseStoredContractConfig } from "./contract/config";
import { templateVariables, unknownVariables } from "./contract/variables";

export interface TypeConfigs {
  surveyConfig?: unknown;
  contractConfig?: unknown;
  /** El modo de contacto del formulario (R3): una encuesta "una vez por contacto" lo necesita prendido. */
  contactMode?: string;
  /** Solo un EOD: su configuración (de ahí sale la variante). */
  eodConfig?: unknown;
}

export function surveyChecks(config: unknown, contactMode?: string): (definition: FormDefinition) => string[] {
  return (definition) => {
    if (contactMode === "none" && (config as { oncePerContact?: boolean } | null)?.oncePerContact === true) {
      return ['La encuesta está limitada a "una vez por contacto", pero las respuestas no se vinculan con contactos: prendé el vínculo en la pestaña Contacto o sacá el límite'];
    }
    const scoreKey = (config as { scoreFieldKey?: string } | null)?.scoreFieldKey;
    const field = definition.fields.find((f) => f.key === scoreKey);
    if (!field) return ["La encuesta necesita un campo de puntaje principal (estrellas o NPS)"];
    if (!isScoreType(field.type)) return [`El puntaje principal tiene que ser un campo de estrellas o NPS ("${field.label}" no lo es)`];
    if (!field.required) return [`El puntaje principal tiene que ser obligatorio ("${field.label}" es opcional)`];
    return [];
  };
}

export function contractChecks(config?: unknown): (definition: FormDefinition) => string[] {
  const mode = parseStoredContractConfig(config).mode;
  return (definition) => {
    const reasons: string[] = [];
    if (!definition.contractText || definition.contractText.trim() === "") reasons.push("El contrato necesita un texto");
    const text = definition.contractText ?? "";
    if (mode === "contract") {
      const unknown = unknownVariables(text, definition.fields.filter((f) => f.type !== "hidden").map((f) => f.key));
      if (unknown.length > 0) reasons.push(`El contrato usa variables que no existen: ${unknown.map((n) => `{{${n}}}`).join(", ")}`);
    } else if (templateVariables(text).length > 0) {
      reasons.push("El texto tiene variables ({{…}}): solo funcionan en modo Contrato. Cambiá el modo o sacalas del texto");
    }
    const hasRequiredEmail = definition.fields.some((f) => f.type === "email" && f.required);
    if (!hasRequiredEmail) reasons.push("El contrato necesita un campo de email obligatorio: ahí se manda la copia firmada");
    return reasons;
  };
}

export function typeChecks(type: FormType, configs: TypeConfigs): Array<(definition: FormDefinition) => string[]> {
  if (type === "survey") return [surveyChecks(configs.surveyConfig, configs.contactMode)];
  if (type === "contract") return [contractChecks(configs.contractConfig)];
  if (type === "eod") return [eodPublishChecks(parseStoredEodConfig(configs.eodConfig)?.variant)];
  return [];
}
