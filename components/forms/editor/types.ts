import type { FormDesign } from "@/lib/forms/defaults";
import type { FormDefinition, FormStatus, FormType } from "@/lib/forms/fields";
import type { SuccessConfig } from "@/lib/forms/success";

/** Lo que el servidor le pasa al editor de un formulario. */
export interface EditorForm {
  id: string;
  name: string;
  type: FormType;
  status: FormStatus;
  slug: string;
  updatedAt: string;
  draftDefinition: FormDefinition;
  design: FormDesign;
  success: SuccessConfig;
  /** Lo último que se publicó (con el texto del contrato), o null si nunca se publicó. */
  publishedSnapshot: FormDefinition | null;
}

export interface EditorVersion {
  number: number;
  publishedAt: string;
  publishedByName: string | null;
  /** Primeros caracteres de la huella (solo contratos). */
  shaPrefix: string | null;
}

export interface Draft {
  name: string;
  definition: FormDefinition;
  design: FormDesign;
  success: SuccessConfig;
}
