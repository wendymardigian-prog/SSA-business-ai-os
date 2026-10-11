"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Checkbox, Field, Notice, Section, inputClass } from "@/components/agents/fields";
import { MAX_CONTRACT_TEXT } from "@/lib/forms/definition-schema";
import { ContractText } from "@/components/forms/public/contract-block";
import { saveContractConfig } from "@/lib/actions/forms/config";
import { parseCcInput, MAX_CC_EMAILS, validateContractConfig, signerEmailField, type ContractConfig } from "@/lib/forms/contract/config";
import type { Draft, EditorForm } from "./types";

/**
 * La pestaña Contrato (F24): el texto (Markdown acotado, con vista previa), el título,
 * la casilla de aceptación, si la firma es obligatoria y las copias por email.
 *
 * El TEXTO es parte del borrador (se guarda solo, como los campos) y se congela, con su
 * huella, al publicar. La configuración se guarda con su propio botón.
 */
export function ContractEditor({
  form,
  draft,
  onDraftChange,
  config,
  onSaved,
  canManage,
}: {
  form: EditorForm;
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
  config: ContractConfig;
  onSaved: (config: ContractConfig) => void;
  canManage: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(config.title);
  const [acceptLabel, setAcceptLabel] = useState(config.acceptLabel);
  const [signatureRequired, setSignatureRequired] = useState(config.signatureRequired);
  const [ccText, setCcText] = useState(config.ccEmails.join(", "));
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, start] = useTransition();

  const disabled = !canManage || form.status === "archived";
  const text = draft.definition.contractText ?? "";
  const hasSignerEmail = useMemo(() => !!signerEmailField(draft.definition.fields), [draft.definition.fields]);
  const cc = parseCcInput(ccText);
  const next = { title, acceptLabel, signatureRequired, ccEmails: cc };
  const validation = validateContractConfig(next);

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveContractConfig({ formId: form.id, config: next });
      if (result.ok && validation.ok) {
        onSaved(validation.config);
        setMessage({ tone: "success", text: "Guardado" });
        router.refresh();
      } else if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {!hasSignerEmail && <Notice tone="warning">El contrato necesita un campo de email obligatorio: ahí se manda la copia firmada. Sumalo en la pestaña Campos.</Notice>}

      <Section title="El texto del contrato" description="Se puede usar # y ## para títulos, **negrita**, *cursiva* y listas. No hay HTML, links ni imágenes. Al publicar, el texto queda congelado con su huella: una firma siempre se refiere al texto exacto que se firmó.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Texto (Markdown)">
            {(id) => (
              <textarea
                id={id}
                className={`${inputClass} min-h-[360px] font-mono text-xs`}
                disabled={disabled}
                value={text}
                maxLength={MAX_CONTRACT_TEXT}
                onChange={(e) => onDraftChange({ ...draft, definition: { ...draft.definition, contractText: e.target.value } })}
              />
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium">Así lo ve quien firma</p>
            <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border bg-card p-4" aria-label="Vista previa del contrato">
              {text.trim() ? <ContractText text={text} /> : <p className="text-sm text-muted-foreground">Escribí el texto para ver cómo queda.</p>}
            </div>
          </div>
        </div>
      </Section>

      <Section title="La firma y la aceptación">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título del contrato" hint="Aparece arriba del texto y en el PDF.">
            {(id) => <input id={id} className={inputClass} disabled={disabled} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Texto de la casilla de aceptación" hint="La casilla es siempre obligatoria.">
            {(id) => <input id={id} className={inputClass} disabled={disabled} value={acceptLabel} maxLength={200} onChange={(e) => setAcceptLabel(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-4">
          <Checkbox checked={signatureRequired} onChange={setSignatureRequired} label="La firma dibujada es obligatoria" description="Sin esto, alcanza con aceptar la casilla (el PDF dice que no hubo firma dibujada)." />
        </div>
      </Section>

      <Section title="Copias por email" description="La persona que firma recibe su copia en el email del formulario. Podés mandarla también a hasta tres direcciones más.">
        <Field label="Direcciones de copia" hint={`Separadas por coma. Hasta ${MAX_CC_EMAILS}.`}>
          {(id) => <input id={id} className={inputClass} disabled={disabled} value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="legal@tuempresa.com" />}
        </Field>
        {!validation.ok && <p className="mt-2 text-xs text-destructive">{validation.errors[0]}</p>}
      </Section>

      {message && (
        <div role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {canManage && (
        <button
          type="button"
          onClick={save}
          disabled={disabled || saving || !validation.ok}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar la configuración
        </button>
      )}
    </div>
  );
}
