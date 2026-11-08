"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { VariableChips } from "@/components/flow-builder/panels/variable-chips";
import { EmailDeliveryNotice } from "@/components/email/email-delivery-notice";
import { MAX_VARIANTS } from "@/lib/broadcasts/render";
import type { BroadcastChannelKind } from "@/lib/broadcasts/audience";

/**
 * Los campos del mensaje de un broadcast: por chat, hasta 5 versiones con
 * variables; por email, asunto, texto de vista previa y cuerpo con formato.
 * Lo usan el editor de un borrador y "Editar mensaje" de uno programado o
 * pausado, así los dos escriben exactamente lo mismo.
 */
export function BroadcastMessageFields({
  idBase,
  kind,
  variants,
  onVariantsChange,
  emailSubject,
  onEmailSubjectChange,
  emailPreheader,
  onEmailPreheaderChange,
  variableList,
  inputClass,
}: {
  /** Para los id de los campos (uno por broadcast). */
  idBase: string;
  kind: BroadcastChannelKind | null;
  variants: string[];
  onVariantsChange: (next: string[] | ((prev: string[]) => string[])) => void;
  emailSubject: string;
  onEmailSubjectChange: (value: string) => void;
  emailPreheader: string;
  onEmailPreheaderChange: (value: string) => void;
  variableList: string[];
  inputClass: string;
}) {
  const textareas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focused, setFocused] = useState(0);

  function insertVariable(token: string) {
    const i = Math.min(focused, variants.length - 1);
    const el = textareas.current[i];
    const current = variants[i] ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const nextText = current.slice(0, start) + token + current.slice(end);
    onVariantsChange((prev) => prev.map((v, idx) => (idx === i ? nextText : v)));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  if (kind === "email") {
    return (
      <div className="space-y-3">
        {/* La guardia de entrega (00287): si los rebotes y quejas no llegan, el freno no puede funcionar. */}
        <EmailDeliveryNotice />
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Asunto</span>
          <input value={emailSubject} onChange={(e) => onEmailSubjectChange(e.target.value)} maxLength={200} className={inputClass} placeholder="Ej.: {{contact.first_name|Hola}}, tenemos novedades" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Texto de vista previa (opcional)</span>
          <input value={emailPreheader} onChange={(e) => onEmailPreheaderChange(e.target.value)} maxLength={200} className={inputClass} placeholder="Lo que se lee al lado del asunto en la bandeja de entrada" />
        </label>
        <RichTextEditor
          id={`bc-email-${idBase}`}
          label="Cuerpo del email"
          value={variants[0] ?? ""}
          onChange={(body) => onVariantsChange([body])}
          variables={[...variableList, "unsubscribe_url"]}
        />
        <p className="text-xs text-muted-foreground">Sale como email de marketing: lleva el link de baja al pie y no le llega a quien se dio de baja.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {variants.map((v, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">{variants.length > 1 ? `Versión ${i + 1}` : "Mensaje"}</span>
            {variants.length > 1 && (
              <button
                type="button"
                onClick={() => onVariantsChange((prev) => prev.filter((_, idx) => idx !== i))}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden /> Quitar
              </button>
            )}
          </div>
          <textarea
            ref={(el) => {
              textareas.current[i] = el;
            }}
            value={v}
            onFocus={() => setFocused(i)}
            onChange={(e) => onVariantsChange((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
            rows={4}
            maxLength={4000}
            aria-label={variants.length > 1 ? `Versión ${i + 1} del mensaje` : "Mensaje"}
            placeholder="Hola {{contact.first_name|}}, …"
            className={inputClass}
          />
        </div>
      ))}
      <VariableChips variables={variableList} onInsert={insertVariable} hint="Tocá una variable para agregarla donde está el cursor. Para un respaldo: {{contact.first_name|amigo}}." />
      {variants.length < MAX_VARIANTS && (
        <button
          type="button"
          onClick={() => onVariantsChange((prev) => [...prev, ""])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Otra versión
        </button>
      )}
    </div>
  );
}
