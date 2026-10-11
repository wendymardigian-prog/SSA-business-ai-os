/**
 * Lo que trae un formulario recién creado, según su tipo. Puro.
 */
import { defaultDefinition, type FormDefinition, type FormType } from "./fields";
import type { SurveyCategory } from "./survey-categories";

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
