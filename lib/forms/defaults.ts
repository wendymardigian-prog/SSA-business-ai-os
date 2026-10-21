/**
 * Lo que trae un formulario recién creado, según su tipo. Puro.
 */
import { defaultDefinition, type FormDefinition, type FormType } from "./fields";
import type { SurveyCategory } from "./survey-categories";
import { eodTemplate } from "@/lib/eod/templates";
import type { EodVariant } from "@/lib/eod/types";

export interface FormDesign {
  title: string;
  intro: string;
  submitLabel: string;
  showLogo: boolean;
}

export interface SurveyConfig {
  scoreFieldKey: string;
  category: SurveyCategory;
  oncePerContact: boolean;
}

export interface ContractConfig {
  title: string;
  signatureRequired: boolean;
  acceptLabel: string;
  ccEmails: string[];
  /** Mandarle también la copia firmada al Owner del negocio (por defecto, sí). */
  copyToOwner: boolean;
}

export const DEFAULT_ACCEPT_LABEL = "Leí y acepto el contrato";

export function defaultDesign(name: string): FormDesign {
  return { title: name, intro: "", submitLabel: "", showLogo: true };
}

export function defaultSurveyConfig(): SurveyConfig {
  return { scoreFieldKey: "nps", category: "servicio", oncePerContact: false };
}

export function defaultContractConfig(name: string): ContractConfig {
  return { title: name, signatureRequired: true, acceptLabel: DEFAULT_ACCEPT_LABEL, ccEmails: [], copyToOwner: true };
}

export interface NewFormParts {
  definition: FormDefinition;
  design: FormDesign;
  surveyConfig: SurveyConfig | null;
  contractConfig: ContractConfig | null;
}

/** `variant` solo cuenta para un EOD: decide si nace con la plantilla de setters (con canales) o la general. */
export function newFormParts(type: FormType, name: string, variant: EodVariant = "general"): NewFormParts {
  return {
    definition: type === "eod" ? eodTemplate(variant) : defaultDefinition(type),
    design: defaultDesign(name),
    surveyConfig: type === "survey" ? defaultSurveyConfig() : null,
    contractConfig: type === "contract" ? defaultContractConfig(name) : null,
  };
}
