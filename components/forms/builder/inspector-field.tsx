"use client";

import { Copy, Trash2 } from "lucide-react";
import { Field, inputClass } from "@/components/agents/fields";
import { targetsFor, type ContactConfig, type CustomFieldDef } from "@/lib/forms/contact-config";
import { setFieldMapping, mappingOf } from "@/lib/forms/contact-map";
import { EOD_FIELD_TYPES, FIELD_TYPE_LABELS, FORM_FIELD_TYPES, type FormField, type FormFieldType } from "@/lib/forms/fields";
import { FieldEditor } from "./field-editor";
import type { CardActions } from "./question-card";

/**
 * El panel de una pregunta (plano formularios-ui, F11): el tipo, lo que se muestra, lo propio de cada tipo, adonde se
 * guarda en el contacto, la logica, lo avanzado (clave y llenar desde la URL) y duplicar / eliminar. Todo a la vista,
 * sin secciones plegadas. El contenido por tipo es `FieldEditor`; esto le suma lo que depende del formulario entero.
 */
export function InspectorField({
  field,
  index,
  fields,
  mode,
  formType,
  neverPublished,
  disabled,
  contactConfig,
  customFields,
  onContactConfig,
  onOpenContact,
  changeType,
  patch,
  setKey,
  actions,
}: {
  field: FormField;
  index: number;
  fields: FormField[];
  mode: "form" | "eod";
  formType: string;
  neverPublished: boolean;
  disabled: boolean;
  contactConfig?: ContactConfig;
  customFields?: CustomFieldDef[];
  /** El mapeo cambio; `notice` dice a que pregunta se le saco el dato (si habia otra). */
  onContactConfig?: (next: ContactConfig, notice: string | null) => void;
  onOpenContact?: () => void;
  changeType: (id: string, type: FormFieldType) => void;
  patch: (id: string, patch: Partial<FormField>) => void;
  setKey: (id: string, key: string) => string | undefined;
  actions: CardActions;
}) {
  const isEod = mode === "eod";
  const types: readonly FormFieldType[] = formType === "eod" || isEod ? EOD_FIELD_TYPES : FORM_FIELD_TYPES;
  // Un campo que ya existe con un tipo que el formulario no ofrece lo conserva en la lista.
  const typeOptions = types.includes(field.type) ? types : [field.type, ...types];

  const typeSlot = (
    <Field label="Tipo de pregunta">
      {(id) => (
        <select id={id} className={inputClass} disabled={disabled} value={field.type} onChange={(e) => changeType(field.id, e.target.value as FormFieldType)}>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const contactSlot =
    !isEod && contactConfig ? (
      <ContactMapping field={field} fields={fields} config={contactConfig} customFields={customFields ?? []} disabled={disabled} onChange={onContactConfig} onOpenContact={onOpenContact} />
    ) : undefined;

  return (
    <FieldEditor
      key={field.id}
      mode={mode}
      field={field}
      index={index}
      fields={fields}
      neverPublished={neverPublished}
      disabled={disabled}
      typeSlot={typeSlot}
      contactSlot={contactSlot}
      onPatch={(p) => patch(field.id, p)}
      onRelabel={(label) => actions.relabel(field.id, label)}
      onSetKey={(key) => setKey(field.id, key)}
      footer={
        disabled ? null : (
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => actions.duplicate(field.id)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
              <Copy className="h-4 w-4" aria-hidden /> Duplicar
            </button>
            <button type="button" onClick={() => actions.remove(field.id)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" aria-hidden /> Eliminar
            </button>
          </div>
        )
      }
    />
  );
}

function ContactMapping({
  field,
  fields,
  config,
  customFields,
  disabled,
  onChange,
  onOpenContact,
}: {
  field: FormField;
  fields: FormField[];
  config: ContactConfig;
  customFields: CustomFieldDef[];
  disabled: boolean;
  onChange?: (next: ContactConfig, notice: string | null) => void;
  onOpenContact?: () => void;
}) {
  const targets = targetsFor(field, customFields);
  const unlinked = config.mode === "none";
  const groups = ["Contacto", "Campos personalizados"] as const;
  return (
    <div className="rounded-lg border border-border p-3">
      <Field
        label="Se guarda en el contacto"
        hint={
          unlinked ? (
            <>
              Las respuestas no se vinculan con contactos.{" "}
              <button type="button" onClick={onOpenContact} className="underline hover:text-foreground">
                Cambiarlo en Contacto
              </button>
            </>
          ) : (
            <>
              Un dato del contacto lo usa una sola pregunta.{" "}
              <button type="button" onClick={onOpenContact} className="underline hover:text-foreground">
                Ver en Contacto
              </button>
            </>
          )
        }
      >
        {(id) => (
          <select
            id={id}
            className={inputClass}
            disabled={disabled || unlinked || targets.length === 0}
            value={mappingOf(config, field.key)}
            onChange={(e) => {
              const result = setFieldMapping(config, fields, customFields, field.key, e.target.value || null);
              if (result.error) return;
              onChange?.(result.config, result.displaced ? `El dato pasó a "${field.label || field.key}": se lo sacamos a "${result.displaced.label}".` : null);
            }}
          >
            <option value="">No se guarda en el contacto</option>
            {groups.map((group) => {
              const list = targets.filter((t) => t.group === group);
              return list.length === 0 ? null : (
                <optgroup key={group} label={group}>
                  {list.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        )}
      </Field>
    </div>
  );
}
