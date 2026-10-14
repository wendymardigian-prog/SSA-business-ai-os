"use client";

import { useState } from "react";
import type { SendEmailNodeData } from "@/lib/flow-engine/nodes/send-email";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

/**
 * El panel de «Enviar email» en el lienzo: a quién (el contacto, una dirección fija o la dirección de una variable), el asunto
 * y el texto. El destino «una variable» (Tirón 2, D4) no necesita contacto: sirve para escribirle a quien llenó un webhook.
 * Los destinos de las pantallas de agenda y de fin de día (anfitrión, equipo) los arma su editor de pasos, no este.
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
  const [target, setTarget] = useState<"body" | "toVariable">("body");
  const insert = (variable: string) => {
    const token = `{{${variable}}}`;
    if (target === "toVariable" && mode === "variable") set({ toVariable: `${data.toVariable ?? ""}${token}` });
    else set({ body: `${data.body ?? ""}${token}` });
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="em-to" className={labelClass}>A quién</label>
        <select id="em-to" value={mode} onChange={(e) => set({ to: e.target.value as SendEmailNodeData["to"] })} className={inputClass}>
          <option value="contact">Al contacto</option>
          <option value="fixed">A una dirección fija</option>
          <option value="variable">A la dirección de una variable</option>
          {/* Los destinos que arman las pantallas de agenda y de fin de día se conservan si el paso ya los tenía. */}
          {mode === "host" && <option value="host">Al anfitrión de la reunión</option>}
          {mode === "member" && <option value="member">A quien envió el reporte</option>}
          {mode === "users" && <option value="users">A personas del equipo</option>}
        </select>
        {mode === "fixed" && (
          <input aria-label="Dirección de email" type="email" value={data.fixedEmail ?? ""} onChange={(e) => set({ fixedEmail: e.target.value })} placeholder="equipo@negocio.com" className={`${inputClass} mt-2`} />
        )}
        {mode === "variable" && (
          <>
            <input aria-label="Variable con la dirección" type="text" value={data.toVariable ?? ""} onFocus={() => setTarget("toVariable")} onChange={(e) => set({ toVariable: e.target.value })} placeholder="{{webhook.body.email}}" className={`${inputClass} mt-2 font-mono`} />
            <p className="mt-1.5 text-xs text-muted-foreground">Si la variable está vacía o no es un email válido, el paso se saltea y queda anotado. Si la dirección es de un contacto marcado «no contactar», no se manda.</p>
          </>
        )}
        {mode === "contact" && <p className="mt-1.5 text-xs text-muted-foreground">Necesita un contacto: en un flujo de webhook, poné antes «Crear o actualizar contacto».</p>}
      </div>

      <div>
        <label htmlFor="em-subject" className={labelClass}>Asunto</label>
        <input id="em-subject" type="text" value={data.subject ?? ""} onFocus={() => setTarget("body")} onChange={(e) => set({ subject: e.target.value })} className={inputClass} />
      </div>

      <div>
        <label htmlFor="em-body" className={labelClass}>Mensaje</label>
        <textarea id="em-body" rows={6} value={data.body ?? ""} onFocus={() => setTarget("body")} onChange={(e) => set({ body: e.target.value })} className={inputClass} />
        <p className="mt-1.5 text-xs text-muted-foreground">Podés usar variables. Sin asunto ni mensaje no se manda nada.</p>
      </div>

      {availableVariables && availableVariables.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground/70">Tocá una variable para agregarla {target === "toVariable" && mode === "variable" ? "a la dirección" : "al mensaje"}.</p>
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
