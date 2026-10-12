/**
 * Los formularios que respondió un contacto, para su ficha (R8). PURO: decide qué se pinta; la consulta vive en
 * `lib/forms/data/contact-forms.ts` y el componente solo lo compone.
 */
import { FORM_TYPE_LABELS, type FormType } from "./fields";

/** Cuántas respuestas se muestran en la ficha antes de "Ver todas". */
export const CONTACT_FORMS_LIMIT = 20;

export const NPS_CATEGORY_LABELS: Record<string, string> = { promoter: "Promotor", passive: "Pasivo", detractor: "Detractor" };

/** El estado de la COPIA firmada que se manda por email (en femenino: es "la copia"). */
export const COPY_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  sent: "Enviada",
  retrying: "Reintentando",
  not_sent: "No enviada",
};

export interface SubmissionInput {
  id: string;
  form_id: string;
  form_version_id: string | null;
  created_at: string;
  score: number | null;
  nps_category: string | null;
}

export interface ContactFormRow {
  id: string;
  formId: string;
  formName: string;
  formType: FormType;
  /** "Personalizado", "Encuesta" o "Contrato". */
  typeLabel: string;
  /** Cuándo la envió (ISO). */
  sentAt: string;
  /** Solo una encuesta: "Puntaje 4 · Detractor". */
  surveyText: string | null;
  /** Solo un contrato firmado. */
  contract: { versionNumber: number | null; copyStatus: string; copyLabel: string; canViewPdf: boolean } | null;
  href: string;
}

export function surveyText(score: number | null, npsCategory: string | null): string | null {
  if (score === null || score === undefined) return null;
  const category = npsCategory ? NPS_CATEGORY_LABELS[npsCategory] : null;
  return category ? `Puntaje ${score} · ${category}` : `Puntaje ${score}`;
}

export function copyStatusLabel(status: string | null | undefined): string {
  return COPY_STATUS_LABELS[status ?? ""] ?? "Pendiente";
}

export function responseHref(formId: string, submissionId: string): string {
  return `/dashboard/formularios/${formId}/respuestas/${submissionId}`;
}

/** "Ver todas" lleva a la lista de todas las respuestas del contacto. */
export function viewAllFormsHref(contactId: string): string {
  return `/dashboard/contacts/${encodeURIComponent(contactId)}/formularios`;
}

/** "1 formulario" / "3 formularios". */
export function totalLabel(total: number): string {
  return total === 1 ? "1 formulario" : `${total} formularios`;
}

export interface BuildRowsInput {
  submissions: SubmissionInput[];
  forms: Array<{ id: string; name: string; type: string }>;
  versions: Array<{ id: string; version_number: number }>;
  signatures: Array<{ submission_id: string; email_status: string | null; pdf_status: string | null }>;
}

/** Las filas, en el orden en que llegan (de la más nueva a la más vieja). Una respuesta de un formulario que ya no se ve se omite. */
export function buildContactFormRows(input: BuildRowsInput): ContactFormRow[] {
  const forms = new Map(input.forms.map((f) => [f.id, f]));
  const versions = new Map(input.versions.map((v) => [v.id, v.version_number]));
  const signatures = new Map(input.signatures.map((s) => [s.submission_id, s]));
  const rows: ContactFormRow[] = [];
  for (const s of input.submissions) {
    const form = forms.get(s.form_id);
    if (!form) continue;
    const formType = (form.type in FORM_TYPE_LABELS ? form.type : "custom") as FormType;
    const signature = formType === "contract" ? signatures.get(s.id) : undefined;
    rows.push({
      id: s.id,
      formId: form.id,
      formName: form.name,
      formType,
      typeLabel: FORM_TYPE_LABELS[formType],
      sentAt: s.created_at,
      surveyText: formType === "survey" ? surveyText(s.score, s.nps_category) : null,
      contract:
        formType === "contract"
          ? {
              versionNumber: s.form_version_id ? (versions.get(s.form_version_id) ?? null) : null,
              copyStatus: signature?.email_status ?? "pending",
              copyLabel: copyStatusLabel(signature?.email_status),
              canViewPdf: signature?.pdf_status === "generated",
            }
          : null,
      href: responseHref(form.id, s.id),
    });
  }
  return rows;
}
