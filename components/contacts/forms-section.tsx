import Link from "next/link";
import { Section } from "./ui";
import { FormPdfButton } from "./form-pdf-button";
import { CONTACT_FORMS_LIMIT, totalLabel, viewAllFormsHref, type ContactFormRow } from "@/lib/forms/contact-forms";
import { formatInZone } from "@/lib/forms/responses-query";

/** La lista de respuestas de un contacto (la usan la sección de la ficha y la página "Ver todas"). */
export function ContactFormsList({ rows, timeZone }: { rows: ContactFormRow[]; timeZone: string }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <Link href={row.href} className="min-w-0 flex-1 hover:underline">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.formName}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{row.typeLabel}</span>
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {formatInZone(row.sentAt, timeZone)}
              {row.surveyText ? ` · ${row.surveyText}` : ""}
              {row.contract ? ` · Firmado${row.contract.versionNumber ? ` · versión ${row.contract.versionNumber}` : ""} · Copia: ${row.contract.copyLabel}` : ""}
            </span>
          </Link>
          {row.contract?.canViewPdf && <FormPdfButton submissionId={row.id} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * Los formularios que respondió este contacto (R8). Solo se pinta con `forms.view`. Lo que se ve lo decide la RLS
 * (`can_see_form_submission`); las respuestas marcadas como spam no aparecen.
 */
export function ContactFormsSection({ rows, total, contactId, timeZone }: { rows: ContactFormRow[]; total: number; contactId: string; timeZone: string }) {
  return (
    <Section title="Formularios" action={total > 0 ? <span className="text-xs text-muted-foreground">{totalLabel(total)}</span> : undefined}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no respondió ningún formulario.</p>
      ) : (
        <>
          <ContactFormsList rows={rows} timeZone={timeZone} />
          {total > CONTACT_FORMS_LIMIT && (
            <p className="pt-2 text-sm">
              <Link href={viewAllFormsHref(contactId)} className="text-primary underline-offset-2 hover:underline">
                Ver todas ({total})
              </Link>
            </p>
          )}
        </>
      )}
    </Section>
  );
}
