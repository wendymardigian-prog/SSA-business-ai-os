"use client";

import { Plus, X } from "lucide-react";
import { WhatsappBanRiskNotice } from "@/components/channels/whatsapp-ban-risk-notice";
import { GroupSelect } from "./group-select";
import type { SendPollData } from "@/lib/flow-engine/nodes/send-poll";
import { POLL_MAX_OPTIONS } from "@/lib/whatsapp-groups/poll";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

/**
 * El panel de «Enviar encuesta» (Grupos de WhatsApp): a qué grupo, la pregunta, las opciones y si se puede elegir
 * más de una. La pregunta y las opciones admiten variables. Sus votos pueden disparar «Votó en una encuesta de un
 * grupo» con «Las que manda un paso».
 */
export function SendPollPanel({ data: raw, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const data = raw as SendPollData & Record<string, unknown>;
  const options = Array.isArray(data.options) ? data.options : ["", ""];
  const setOptions = (next: string[]) => onChange({ ...data, options: next });

  return (
    <div className="space-y-4">
      <WhatsappBanRiskNotice />

      <div>
        <label htmlFor="poll-group" className={labelClass}>A qué grupo</label>
        <GroupSelect id="poll-group" value={data.groupId} onChange={(groupId) => onChange({ ...data, groupId })} />
      </div>

      <div>
        <label htmlFor="poll-question" className={labelClass}>Pregunta</label>
        <input id="poll-question" type="text" value={data.question ?? ""} onChange={(e) => onChange({ ...data, question: e.target.value })} placeholder="¿Qué día te queda mejor?" className={inputClass} />
      </div>

      <fieldset>
        <legend className={labelClass}>Opciones</legend>
        <div className="space-y-1.5">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                type="text"
                value={option}
                aria-label={`Opción ${index + 1}`}
                onChange={(e) => setOptions(options.map((o, i) => (i === index ? e.target.value : o)))}
                placeholder={`Opción ${index + 1}`}
                className={inputClass}
              />
              {options.length > 2 && (
                <button type="button" aria-label={`Quitar la opción ${index + 1}`} onClick={() => setOptions(options.filter((_, i) => i !== index))} className="rounded p-1 text-muted-foreground hover:bg-muted">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < POLL_MAX_OPTIONS && (
          <button type="button" onClick={() => setOptions([...options, ""])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-ink hover:underline">
            <Plus className="h-3 w-3" aria-hidden />
            Agregar opción
          </button>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data.multiple === true} onChange={(e) => onChange({ ...data, multiple: e.target.checked })} />
        Se puede elegir más de una opción
      </label>

      <p className="text-[11px] text-muted-foreground">
        La pregunta y las opciones admiten variables ({"{{contact.first_name}}"}). WhatsApp acepta de 2 a {POLL_MAX_OPTIONS} opciones distintas. Para
        reaccionar a los votos, armá otra automatización con «Votó en una encuesta de un grupo» → «Las que manda un paso».
      </p>
    </div>
  );
}
