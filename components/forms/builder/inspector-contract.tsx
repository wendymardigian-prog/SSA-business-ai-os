"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Checkbox, Field, Notice, inputClass } from "@/components/agents/fields";
import { saveContractConfig } from "@/lib/actions/forms/config";
import { MAX_CC_EMAILS, parseCcInput, validateContractConfig, type ContractConfig } from "@/lib/forms/contract/config";

/**
 * El panel del contrato en Diseño (antes, la pestaña Contrato): el título, la casilla de aceptación, si la firma es
 * obligatoria y las copias por email. Se guarda con su propio botón (no es parte del borrador: rige apenas se guarda).
 */
export function InspectorContract({
  formId,
  config,
  onSaved,
  canManage,
  disabled,
  hasSignerEmail,
}: {
  formId: string;
  config: ContractConfig;
  onSaved: (config: ContractConfig) => void;
  canManage: boolean;
  disabled: boolean;
  /** El contrato necesita un email obligatorio (ahí va la copia firmada). */
  hasSignerEmail: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(config.title);
  const [acceptLabel, setAcceptLabel] = useState(config.acceptLabel);
  const [signatureRequired, setSignatureRequired] = useState(config.signatureRequired);
  const [ccText, setCcText] = useState(config.ccEmails.join(", "));
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, start] = useTransition();

  const next = { ...config, title, acceptLabel, signatureRequired, ccEmails: parseCcInput(ccText) };
  const validation = validateContractConfig(next);

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveContractConfig({ formId, config: next });
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
    <div className="space-y-4">
      {!hasSignerEmail && <Notice tone="warning">El contrato necesita una pregunta de email obligatoria: ahí se manda la copia firmada.</Notice>}

      <Field label="Título del contrato" hint="Aparece arriba del texto y en el PDF.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="Texto de la casilla de aceptación" hint="La casilla es siempre obligatoria.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={acceptLabel} maxLength={200} onChange={(e) => setAcceptLabel(e.target.value)} />}
      </Field>
      <Checkbox
        checked={signatureRequired}
        onChange={setSignatureRequired}
        label="La firma dibujada es obligatoria"
        description="Sin esto, alcanza con aceptar la casilla (el PDF dice que no hubo firma dibujada)."
      />
      <Field label="Copias por email" hint={`Quien firma recibe su copia. Sumá hasta ${MAX_CC_EMAILS} direcciones más, separadas por coma.`}>
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="legal@tuempresa.com" />}
      </Field>
      {!validation.ok && <p className="text-xs text-destructive">{validation.errors[0]}</p>}

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
          Guardar los ajustes del contrato
        </button>
      )}
    </div>
  );
}
