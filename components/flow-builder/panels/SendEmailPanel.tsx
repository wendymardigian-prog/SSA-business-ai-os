"use client";

import type { SendEmailNodeData } from "@/lib/flow-engine/nodes/send-email";
import { FieldEmojiButton } from "@/components/ui/emoji-picker";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { InsertAssetButton } from "@/components/response-assets/insert-asset-button";
import { VariableChips } from "./variable-chips";
import { EmailAttachmentsField } from "./EmailAttachmentsField";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

/**
 * El panel de «Enviar email» en el lienzo: a quién (el contacto, una dirección fija o la dirección de una variable), el asunto
 * y el texto. El destino «una variable» (Tirón 2, D4) no necesita contacto: sirve para escribirle a quien llenó un webhook.
 * Los destinos propios de otras pantallas (el anfitrión de la agenda, el equipo) los arma su editor de pasos, no este.
 */
export function SendEmailPanel({
  data: raw,
  onChange,
  availableVariables,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  availableVariables?: string[];
}) {
  const data = raw as SendEmailNodeData & Record<string, unknown>;
  const set = (patch: Partial<SendEmailNodeData>) => onChange({ ...data, ...patch });
  const mode = data.to ?? "contact";
  // Las variables del cuerpo se insertan desde el editor (como fichas); esta lista es solo para la dirección.
  const insert = (variable: string) => set({ toVariable: `${data.toVariable ?? ""}{{${variable}}}` });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="em-to" className={labelClass}>A quién</label>
        <select id="em-to" value={mode} onChange={(e) => set({ to: e.target.value as SendEmailNodeData["to"] })} className={inputClass}>
          <option value="contact">Al contacto</option>
          <option value="fixed">A una dirección fija</option>
          <option value="variable">A la dirección de una variable</option>
          {/* Los destinos que arman otras pantallas se conservan si el paso ya los tenía. */}
          {mode === "host" && <option value="host">Al anfitrión de la reunión</option>}
          {mode === "member" && <option value="member">A quien envió el reporte</option>}
          {mode === "users" && <option value="users">A personas del equipo</option>}
        </select>
        {mode === "fixed" && (
          <input aria-label="Dirección de email" type="email" value={data.fixedEmail ?? ""} onChange={(e) => set({ fixedEmail: e.target.value })} placeholder="equipo@negocio.com" className={`${inputClass} mt-2`} />
        )}
        {mode === "variable" && (
          <>
            <input aria-label="Variable con la dirección" type="text" value={data.toVariable ?? ""} onChange={(e) => set({ toVariable: e.target.value })} placeholder="{{webhook.payload.email}}" className={`${inputClass} mt-2 font-mono`} /> {/* @plantilla-quitar(webhooks) */}
            {/* @plantilla-sin(webhooks): <input aria-label="Variable con la dirección" type="text" value={data.toVariable ?? ""} onChange={(e) => set({ toVariable: e.target.value })} placeholder="{{contact.email}}" className={`${inputClass} mt-2 font-mono`} /> */}
            <p className="mt-1.5 text-xs text-muted-foreground">Si la variable está vacía o no es un email válido, el paso se saltea y queda anotado. Si la dirección es de un contacto marcado «no contactar», no se manda.</p>
          </>
        )}
        {mode === "contact" && <p className="mt-1.5 text-xs text-muted-foreground">Necesita un contacto: en un flujo de webhook, poné antes «Crear o actualizar contacto».</p>} {/* @plantilla-quitar(webhooks) */}
        {/* @plantilla-sin(webhooks): {mode === "contact" && <p className="mt-1.5 text-xs text-muted-foreground">Necesita un contacto: en un flujo sin contacto, el paso se saltea.</p>} */}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="em-subject" className={labelClass}>Asunto</label>
          <FieldEmojiButton targetId="em-subject" value={data.subject ?? ""} onChange={(subject) => set({ subject })} />
        </div>
        <input id="em-subject" type="text" value={data.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} className={inputClass} />
        <VariableChips variables={availableVariables} onInsert={(token) => set({ subject: `${data.subject ?? ""}${token}` })} hint="Tocá una variable para sumarla al asunto." />
      </div>

      <div>
        <label htmlFor="em-body" className={labelClass}>Mensaje</label>
        <RichTextEditor
          id="em-body"
          label="Mensaje del email"
          value={data.body ?? ""}
          variables={availableVariables}
          onChange={(body) => set({ body })}
          extraToolbar={(api) => <InsertAssetButton onInsertText={api.insertText} />}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">Podés usar formato, emojis y variables. Sin asunto ni mensaje no se manda nada.</p>
      </div>

      <EmailAttachmentsField value={data.attachments} onChange={(attachments) => set({ attachments })} />

      {availableVariables && availableVariables.length > 0 && mode === "variable" && (
        <div>
          <p className="text-[11px] text-muted-foreground/70">Tocá una variable para agregarla a la dirección.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {availableVariables.map((variable) => (
              <button key={variable} type="button" onClick={() => insert(variable)} className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-500 hover:bg-blue-50">
                {`{{${variable}}}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
