/**
 * Lo que trae un formulario recién creado, según su tipo. Puro.
 */
import { defaultDefinition, type FormDefinition, type FormType } from "./fields";

export interface FormDesign {
  title: string;
  intro: string;
  submitLabel: string;
  showLogo: boolean;
}

export const SURVEY_CATEGORIES = [
  { value: "servicio", label: "Servicio" },
  { value: "llamada", label: "Llamada" },
  { value: "onboarding", label: "Onboarding" },
  { value: "cierre", label: "Cierre" },
  { value: "general", label: "General" },
] as const;

export interface SurveyConfig {
  scoreFieldKey: string;
  category: (typeof SURVEY_CATEGORIES)[number]["value"];
  oncePerContact: boolean;
}

export interface ContractConfig {
  title: string;
  signatureRequired: boolean;
  acceptLabel: string;
  ccEmails: string[];
}

export const DEFAULT_ACCEPT_LABEL = "Leí y acepto el contrato";

export function defaultDesign(name: string): FormDesign {
  return { title: name, intro: "", submitLabel: "", showLogo: true };
}

export function defaultSurveyConfig(): SurveyConfig {
  return { scoreFieldKey: "nps", category: "servicio", oncePerContact: false };
}

export function defaultContractConfig(name: string): ContractConfig {
  return { title: name, signatureRequired: true, acceptLabel: DEFAULT_ACCEPT_LABEL, ccEmails: [] };
}

export interface NewFormParts {
  definition: FormDefinition;
  design: FormDesign;
  surveyConfig: SurveyConfig | null;
  contractConfig: ContractConfig | null;
}

export function newFormParts(type: FormType, name: string): NewFormParts {
  return {
    definition: defaultDefinition(type),
    design: defaultDesign(name),
    surveyConfig: type === "survey" ? defaultSurveyConfig() : null,
    contractConfig: type === "contract" ? defaultContractConfig(name) : null,
  };
}
