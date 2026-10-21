"use client";

import { useEffect, useState } from "react";
import { BuilderLayout } from "@/components/forms/builder/builder-layout";
import { FormCanvas } from "@/components/forms/builder/form-canvas";
import { InspectorEnd } from "@/components/forms/builder/inspector-end";
import { InspectorField } from "@/components/forms/builder/inspector-field";
import { InspectorForm } from "@/components/forms/builder/inspector-form";
import { InspectorContract } from "@/components/forms/builder/inspector-contract";
import { ContractSigningBlock, ContractTextBlock } from "@/components/forms/builder/contract-blocks";
import { signerEmailField, type ContractConfig } from "@/lib/forms/contract/config";
import { useBuilderActions } from "@/components/forms/builder/use-builder-actions";
import { FIELD_TYPE_LABELS, FORM_TYPE_LABELS, type FormField, type PublicFormType } from "@/lib/forms/fields";
import { FORM_SELECTION, normalizeSelection, selectedIndex, type BuilderSelection } from "@/lib/forms/builder-selection";
import type { PublishIssues } from "@/lib/forms/publish-issues";
import type { ContactConfig, CustomFieldDef } from "@/lib/forms/contact-config";
import type { Draft } from "./types";

/**
 * La pestaña Diseño (plano formularios-ui, F9-F11; antes "Campos"): el formulario como lo ve quien responde, con las preguntas
 * editables en el lugar, y a la derecha el panel de lo que esta elegido (el formulario, una pregunta o la pantalla
 * final). Ya no hay vista previa al costado: la vista previa es el boton de la barra de arriba.
 *
 * Solo compone: las reglas viven en `lib/forms/builder*.ts`, `contact-map.ts` y `publish-issues.ts`.
 */
export function FieldsTab({
  draft,
  onChange,
  disabled,
  neverPublished,
  type,
  contactConfig,
  onContactConfig,
  customFields,
  issues,
  focusRequest,
  onOpenContact,
  contract,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  neverPublished: boolean;
  type: PublicFormType;
  /** El mapeo al contacto, para decirle a cada pregunta adonde va y dejar cambiarlo desde su panel. */
  contactConfig: ContactConfig;
  onContactConfig: (next: ContactConfig) => void;
  customFields: CustomFieldDef[];
  /** Lo que falta para publicar; el aviso y los rojos de las tarjetas salen de aca. Vacio si no se puede editar. */
  issues: PublishIssues;
  /** Pedido de la barra: "llevame al primer problema" (la `nonce` cambia en cada pedido). */
  focusRequest: { fieldKey: string | null; nonce: number } | null;
  onOpenContact: () => void;
  /** Solo un contrato: su texto va en el lienzo y sus ajustes en el panel (antes, la pestaña Contrato). */
  contract?: { formId: string; config: ContractConfig; onConfigSaved: (config: ContractConfig) => void; canManage: boolean };
}) {
  const fields = draft.definition.fields;
  const [rawSelection, setSelection] = useState<BuilderSelection>(FORM_SELECTION);
  const selection = normalizeSelection(rawSelection, fields);
  const [notice, setNotice] = useState<string | null>(null);

  const builder = useBuilderActions({
    fields,
    selection,
    neverPublished,
    onFields: (next: FormField[]) => onChange({ ...draft, definition: { ...draft.definition, fields: next } }),
    onSelect: setSelection,
  });

  // Un aviso (por ejemplo "se lo sacamos a otra pregunta") se va solo.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // "Publicar" con problemas: se elige y se muestra la primera pregunta con un problema.
  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest.fieldKey ? fields.find((f) => f.key === focusRequest.fieldKey) : undefined;
    if (target) setSelection({ kind: "field", id: target.id });
    const frame = window.requestAnimationFrame(() => {
      const el = target ? document.getElementById(`q-${target.id}`) : document.getElementById("publish-issues");
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
    // Solo cuando llega un pedido nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  const index = selectedIndex(selection, fields);
  const current = index >= 0 ? fields[index] : null;

  const TITLES: Partial<Record<BuilderSelection["kind"], string>> = {
    end: "Después de enviar",
    contract_text: "El texto del contrato",
    contract_signing: "Aceptación y firma",
  };
  const title = TITLES[selection.kind] ?? (current ? `Pregunta · ${FIELD_TYPE_LABELS[current.type]}` : "El formulario");

  const contractPanel = contract ? (
    <div className="space-y-4">
      {selection.kind === "contract_text" && (
        <p className="text-xs text-muted-foreground">
          Escribí el texto directo en el lienzo. Usá la barra para los títulos, la negrita, las listas y los links. Al publicar, el texto queda congelado con
          su huella: una firma siempre se refiere al texto exacto que se firmó.
        </p>
      )}
      <InspectorContract
        formId={contract.formId}
        config={contract.config}
        onSaved={contract.onConfigSaved}
        canManage={contract.canManage}
        disabled={disabled}
        hasSignerEmail={!!signerEmailField(fields)}
      />
    </div>
  ) : null;

  const panel = contractPanel && (selection.kind === "contract_text" || selection.kind === "contract_signing") ? (
    contractPanel
  ) : current ? (
    <InspectorField
      field={current}
      index={index}
      fields={fields}
      mode="form"
      formType={type}
      neverPublished={neverPublished}
      disabled={disabled}
      contactConfig={contactConfig}
      customFields={customFields}
      onContactConfig={(next, message) => {
        onContactConfig(next);
        if (message) setNotice(message);
      }}
      onOpenContact={onOpenContact}
      changeType={builder.changeType}
      patch={builder.patch}
      setKey={builder.setKey}
      actions={builder.actions}
    />
  ) : selection.kind === "end" ? (
    <InspectorEnd success={draft.success} onChange={(success) => onChange({ ...draft, success })} fields={fields} disabled={disabled} />
  ) : (
    <InspectorForm
      name={draft.name}
      onName={(name) => onChange({ ...draft, name })}
      design={draft.design}
      onDesign={(design) => onChange({ ...draft, design })}
      fields={fields}
      contactConfig={contactConfig}
      disabled={disabled}
      onOpenContact={onOpenContact}
    />
  );

  return (
    <div className="space-y-4">
      {issues.total > 0 && (
        <div id="publish-issues" role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-semibold">
            Para publicar falta arreglar {issues.total} {issues.total === 1 ? "cosa" : "cosas"}
          </p>
          {issues.general.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {issues.general.slice(0, 6).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {Object.keys(issues.byField).length > 0 && <p className="mt-1">Las preguntas con algo para arreglar están marcadas en rojo.</p>}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-xs">
          {notice}
        </div>
      )}
      <BuilderLayout
        title={title}
        subtitle={selection.kind === "form" ? `${FORM_TYPE_LABELS[type]} · el tipo no se puede cambiar` : undefined}
        back={selection.kind !== "form" ? { label: "Formulario", onClick: () => setSelection(FORM_SELECTION) } : undefined}
        canvas={
          <FormCanvas
            mode="form"
            formType={type}
            fields={fields}
            selection={selection}
            onSelect={setSelection}
            actions={builder.actions}
            dropAt={builder.dropAt}
            onAdd={builder.add}
            disabled={disabled}
            design={draft.design}
            onDesign={(design) => onChange({ ...draft, design })}
            success={draft.success}
            formName={draft.name}
            contactConfig={contactConfig}
            customFields={customFields}
            issues={issues}
            beforeFields={
              contract ? (
                <ContractTextBlock
                  formId={contract.formId}
                  title={contract.config.title}
                  text={draft.definition.contractText ?? ""}
                  onText={(contractText) => onChange({ ...draft, definition: { ...draft.definition, contractText } })}
                  selected={selection.kind === "contract_text"}
                  onSelect={() => setSelection({ kind: "contract_text" })}
                  disabled={disabled}
                />
              ) : undefined
            }
            afterFields={
              contract ? (
                <ContractSigningBlock config={contract.config} selected={selection.kind === "contract_signing"} onSelect={() => setSelection({ kind: "contract_signing" })} />
              ) : undefined
            }
          />
        }
        panel={panel}
      />
    </div>
  );
}
