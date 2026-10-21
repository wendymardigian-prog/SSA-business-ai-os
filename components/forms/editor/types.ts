import type { EmailReadiness } from "@/lib/email/readiness";
import type { FormDesign } from "@/lib/forms/defaults";
import type { FormDefinition, FormStatus, FormType } from "@/lib/forms/fields";
import type { SuccessConfig } from "@/lib/forms/success";
import type { ContactConfig, CustomFieldDef } from "@/lib/forms/contact-config";
import type { ContractConfig, SurveyConfig } from "@/lib/forms/defaults";
import type { FormFlowRow } from "@/lib/forms/data/form-flows";
import type { EodConfig } from "@/lib/eod/config";

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
  /** Cómo la respuesta se vuelve un contacto (no se versiona: vale desde que se guarda). */
  contactConfig: ContactConfig;
  tagsOnSubmit: string[];
  notifyEnabled: boolean;
  notifyUserIds: string[];
  /** Solo una encuesta (F22). */
  surveyConfig: SurveyConfig | null;
  /** Solo un contrato (F24). */
  contractConfig: ContractConfig | null;
  /** Solo un reporte de fin de día (E1). */
  eodConfig: EodConfig | null;
}

/** Lo que las pestañas Contacto y Automatizaciones necesitan además del formulario. */
export interface EditorExtras {
  customFields: CustomFieldDef[];
  tags: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; name: string }>;
  flows: FormFlowRow[];
  /** `flows.edit`: sin eso no se ofrecen las automatizaciones. */
  canFlows: boolean;
  /** Solo un EOD: los roles del workspace (incluidos los de sistema) para "Roles elegidos". */
  roles: Array<{ id: string; name: string }>;
  /** Respuestas (o reportes) que esta persona ve: el numerito de la pestaña Respuestas / Reportes. */
  responseCount: number | null;
  /** Solo un contrato: si la copia firmada por correo va a salir (Resend conectado y sin rechazos). */
  emailReadiness?: EmailReadiness;
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
