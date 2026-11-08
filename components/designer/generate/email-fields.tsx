"use client";

import { useId } from "react";
import { inputClass, textareaClass } from "@/components/designer/editor/overlays";
import { MAX_EMAIL_BODY, MAX_EMAIL_SUBJECT } from "@/lib/designer/email-text";

/** Los dos campos del email que se manda con la pieza: asunto y mensaje, con las variables que se pueden usar. */
export function EmailFields({ subject, body, onChange }: { subject: string; body: string; onChange: (next: { subject: string; body: string }) => void }) {
  const id = useId();
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-subject`} className="text-xs font-medium text-muted-foreground">
          Asunto
        </label>
        <input id={`${id}-subject`} className={inputClass} value={subject} maxLength={MAX_EMAIL_SUBJECT} onChange={(e) => onChange({ subject: e.target.value, body })} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-body`} className="text-xs font-medium text-muted-foreground">
          Mensaje
        </label>
        <textarea id={`${id}-body`} className={textareaClass} rows={6} value={body} maxLength={MAX_EMAIL_BODY} onChange={(e) => onChange({ subject, body: e.target.value })} />
      </div>
      <p className="text-xs text-muted-foreground">
        Podés usar <code className="rounded bg-muted px-1">{"{{design.link}}"}</code> (el link de la pieza), <code className="rounded bg-muted px-1">{"{{design.code}}"}</code> y <code className="rounded bg-muted px-1">{"{{contact.first_name|}}"}</code>. Sale por el email de tu negocio.
      </p>
    </div>
  );
}
