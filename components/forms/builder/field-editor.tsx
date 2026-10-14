"use client";

import type { ReactNode } from "react";
import { Field, Checkbox, inputClass } from "@/components/agents/fields";
import { FIELD_TYPE_LABELS, supportsPrefill, type FormField } from "@/lib/forms/fields";
import { conditionSources } from "@/lib/forms/builder";
import { VisibilityRuleBuilder } from "./visibility-rule-builder";
import { ConsentControl, FileControl, HiddenControl, KeyControl, NumberControl, PrefillControl, SocialControl } from "./field-controls";

/**
 * El panel de un campo (F4): etiqueta, ayuda, obligatorio, opciones, rangos,
 * archivo, consentimiento, oculto, "llenar desde la URL" y condiciones.
 *
 * Aspecto de `QuestionFieldModal.tsx` de prevxcrm, sin el selector de servicio ni
 * el modo de persistencia: el mapeo a contacto vive en la pestaña Contacto.
 */

export function FieldEditor({
  field,
  index,
  fields,
  neverPublished,
  disabled,
  contactLine,
  onOpenContact,
  onPatch,
  onRelabel,
  onSetKey,
  mode = "form",
  typeSlot,
  contactSlot,
  footer,
}: {
  field: FormField;
  index: number;
  fields: FormField[];
  neverPublished: boolean;
  disabled: boolean;
  /** "Se guarda en el contacto: Email" o "No se guarda en el contacto" (R4). Un EOD no lo muestra. */
  contactLine?: string;
  onOpenContact?: () => void;
  onPatch: (patch: Partial<FormField>) => void;
  onRelabel: (label: string) => void;
  onSetKey: (key: string) => string | undefined;
  /**
   * `eod`: un reporte de fin de día. Sin contacto, sin prellenado ni condiciones, y el
   * número suma paso y métrica (`EodNumberSettings`).
   */
  mode?: "form" | "eod";
  /** Debajo del nombre del tipo: el selector para cambiarlo (plano formularios-ui, F11). */
  typeSlot?: ReactNode;
  /** "Se guarda en el contacto": si viene, reemplaza la linea de texto de `contactLine`. */
  contactSlot?: ReactNode;
  /** Al pie: Duplicar y Eliminar. */
  footer?: ReactNode;
}) {
  const isEod = mode === "eod";
  const isHidden = field.type === "hidden";
  const hasOptions = field.type === "single_select" || field.type === "multi_select";
  const textLike = field.type === "short_text" || field.type === "long_text" || field.type === "email" || field.type === "phone" || field.type === "number" || field.type === "social";
  const prefillOk = supportsPrefill(field.type) && !isHidden && !isEod;

  return (
    <div className="space-y-4">
      {typeSlot ?? <p className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</p>}
      {!isEod && !contactSlot && contactLine !== undefined && (
        <p className="text-xs text-muted-foreground">
          {contactLine}{" "}
          <button type="button" onClick={onOpenContact} className="underline hover:text-foreground">
            Ver en Contacto
          </button>
        </p>
      )}

      <Field label="Etiqueta">
        {(id) => <input id={id} className={inputClass} value={field.label} disabled={disabled} maxLength={200} onChange={(e) => onRelabel(e.target.value)} />}
      </Field>

      {!isHidden && (
        <>
          <Field label="Ayuda (opcional)" hint="Aparece debajo del campo.">
            {(id) => <input id={id} className={inputClass} value={field.help ?? ""} disabled={disabled} maxLength={500} onChange={(e) => onPatch({ help: e.target.value || undefined })} />}
          </Field>
          {(textLike || field.type === "date") && field.type !== "date" && (
            <Field label="Texto de ejemplo (opcional)">
              {(id) => <input id={id} className={inputClass} value={field.placeholder ?? ""} disabled={disabled} maxLength={200} onChange={(e) => onPatch({ placeholder: e.target.value || undefined })} />}
            </Field>
          )}
          <Checkbox checked={field.required} onChange={(required) => onPatch({ required })} label="Obligatorio" description={field.type === "consent" ? "Tiene que tildarlo para enviar." : undefined} />
        </>
      )}

      {hasOptions && (
        <Field label="Opciones" hint="Una por línea. De 2 a 50, sin repetir.">
          {(id) => (
            <textarea
              id={id}
              rows={5}
              className={inputClass}
              disabled={disabled}
              value={(field.options ?? []).join("\n")}
              onChange={(e) => onPatch({ options: e.target.value.split("\n") })}
            />
          )}
        </Field>
      )}

      <SocialControl field={field} disabled={disabled} onPatch={onPatch} />
      <NumberControl field={field} disabled={disabled} isEod={isEod} onPatch={onPatch} />
      <FileControl field={field} disabled={disabled} onPatch={onPatch} />
      <ConsentControl field={field} disabled={disabled} onPatch={onPatch} />
      <HiddenControl field={field} disabled={disabled} onPatch={onPatch} offerAttribution />
      {prefillOk && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Llenar desde la URL</legend>
          <PrefillControl field={field} fields={fields} disabled={disabled} onPatch={onPatch} />
        </fieldset>
      )}

      {!isEod && contactSlot}

      {!isEod && (
        <fieldset className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Lógica · mostrar solo si…</legend>
          <VisibilityRuleBuilder value={field.visibility} onChange={(visibility) => onPatch({ visibility })} sources={conditionSources(fields, index)} />
        </fieldset>
      )}

      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-semibold">Avanzado</legend>
        <KeyControl field={field} neverPublished={neverPublished} disabled={disabled} isEod={isEod} onSetKey={onSetKey} />
      </fieldset>
      {footer}
    </div>
  );
}
