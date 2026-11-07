"use client";

import { Plus, X } from "lucide-react";
import {
  isButtonUrl,
  PRIVATE_REPLY_BUTTON_TITLE_MAX,
  PRIVATE_REPLY_MAX_BUTTONS,
  PRIVATE_REPLY_TEXT_MAX,
  type PrivateReplyButton,
} from "@/lib/flow-engine/private-reply";
import { VariableChips } from "./variable-chips";
import { AttributionBlock, type AttributionPanelContext } from "./SendMessagePanel";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

/** El panel de «Responder por privado»: el texto y hasta tres botones que abren un link. */
export function PrivateReplyPanel({
  data,
  onChange,
  availableVariables,
  attributionContext,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  availableVariables?: string[];
  attributionContext?: AttributionPanelContext;
}) {
  const text = typeof data.text === "string" ? data.text : "";
  const buttons = (Array.isArray(data.buttons) ? data.buttons : []) as PrivateReplyButton[];

  const setButtons = (next: PrivateReplyButton[]) => onChange({ ...data, buttons: next });
  const updateButton = (index: number, patch: Partial<PrivateReplyButton>) =>
    setButtons(buttons.map((button, i) => (i === index ? { ...button, ...patch } : button)));

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Instagram permite un solo mensaje por comentario: para mandar otro, la persona tiene que responder.
      </p>

      <div>
        <label htmlFor="pr-text" className={labelClass}>Mensaje</label>
        <textarea
          id="pr-text"
          rows={6}
          maxLength={PRIVATE_REPLY_TEXT_MAX}
          value={text}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
          className={`${inputClass} resize-none`}
        />
        <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, text: `${text}${token}` })} />
      </div>

      <div>
        <p className={labelClass}>Botones con link</p>
        <div className="space-y-3">
          {buttons.map((button, index) => {
            const urlIsWrong = button.url.trim() !== "" && !isButtonUrl(button.url) && !button.url.includes("{{");
            return (
              <div key={index} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Texto del botón ${index + 1}`}
                    value={button.title}
                    maxLength={PRIVATE_REPLY_BUTTON_TITLE_MAX}
                    onChange={(e) => updateButton(index, { title: e.target.value })}
                    placeholder="Texto del botón"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setButtons(buttons.filter((_, i) => i !== index))}
                    aria-label={`Quitar el botón ${index + 1}`}
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  aria-label={`Link del botón ${index + 1}`}
                  type="url"
                  value={button.url}
                  onChange={(e) => updateButton(index, { url: e.target.value })}
                  placeholder="https://"
                  className={inputClass}
                />
                {urlIsWrong && <p role="alert" className="text-xs text-destructive">Escribí el link completo, con https://.</p>}
              </div>
            );
          })}
        </div>
        {buttons.length < PRIVATE_REPLY_MAX_BUTTONS && (
          <button
            type="button"
            onClick={() => setButtons([...buttons, { type: "url", title: "", url: "" }])}
            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar botón
          </button>
        )}
        {buttons.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Instagram puede rechazar los botones si la persona no sigue la cuenta, y en ese caso el mensaje no le llega. Probalo con una cuenta que no te siga antes de dejarlo activo.
          </p>
        )}
      </div>

      {/* Con «Registrar el clic», cada botón sale con su propio link medido: el lienzo cuenta los clics por botón. */}
      {attributionContext && <AttributionBlock data={data} onChange={onChange} context={attributionContext} />}
    </div>
  );
}
