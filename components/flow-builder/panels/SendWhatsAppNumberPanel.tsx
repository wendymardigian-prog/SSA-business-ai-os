"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadWhatsAppChannelOptions } from "@/lib/actions/flow-node-options";
import type { SendWhatsAppNumberData } from "@/lib/flow-engine/nodes/send-whatsapp-number";
import { FieldEmojiButton } from "@/components/ui/emoji-picker";
import { resolveWhatsAppTarget } from "@/lib/flow-engine/whatsapp-target";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

/**
 * El panel de «Enviar WhatsApp a un número» (Tirón 2, D3): a quién (un número fijo o una variable), por qué canal de WhatsApp
 * y qué texto. Sin contacto: sirve para avisar a alguien que no es un contacto. Si no hay ningún WhatsApp conectado, lo dice.
 */
export function SendWhatsAppNumberPanel({
  data: raw,
  onChange,
  availableVariables,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  availableVariables?: string[];
}) {
  const data = raw as SendWhatsAppNumberData & Record<string, unknown>;
  const [channels, setChannels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWhatsAppChannelOptions()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setChannels(res.channels);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<SendWhatsAppNumberData>) => onChange({ ...data, ...patch });
  const mode = data.to ?? "fixed";
  const [target, setTarget] = useState<"text" | "toVariable">("text");
  const insert = (variable: string) => {
    const token = `{{${variable}}}`;
    if (target === "toVariable" && mode === "variable") set({ toVariable: `${data.toVariable ?? ""}${token}` });
    else set({ text: `${data.text ?? ""}${token}` });
  };

  // Lo que se entiende del destino con lo que hay escrito (un número fijo se valida acá mismo; una variable, al correr).
  const fixedCheck = mode === "fixed" && (data.fixedPhone ?? "").trim() ? resolveWhatsAppTarget({ to: "fixed", fixedPhone: data.fixedPhone }, {}) : null;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="wa-to" className={labelClass}>A quién</label>
        <select id="wa-to" value={mode} onChange={(e) => set({ to: e.target.value as "fixed" | "variable" })} className={inputClass}>
          <option value="fixed">Un número fijo</option>
          <option value="variable">El número de una variable</option>
        </select>
        {mode === "fixed" ? (
          <>
            <input aria-label="Número de WhatsApp" type="tel" value={data.fixedPhone ?? ""} onChange={(e) => set({ fixedPhone: e.target.value })} placeholder="+54 9 11 2233 4455" className={`${inputClass} mt-2`} />
            {fixedCheck && !fixedCheck.ok && <p role="alert" className="mt-1.5 text-xs text-destructive">{fixedCheck.reason}</p>}
            {fixedCheck?.ok && <p className="mt-1.5 text-xs text-muted-foreground">Se va a mandar a {fixedCheck.phone}.</p>}
          </>
        ) : (
          <>
            <input aria-label="Variable con el número" type="text" value={data.toVariable ?? ""} onFocus={() => setTarget("toVariable")} onChange={(e) => set({ toVariable: e.target.value })} placeholder="{{webhook.body.telefono}}" className={`${inputClass} mt-2 font-mono`} />
            <p className="mt-1.5 text-xs text-muted-foreground">Si la variable está vacía o no es un número válido, el paso se saltea y queda anotado.</p>
          </>
        )}
      </div>

      <div>
        <label htmlFor="wa-channel" className={labelClass}>Canal de WhatsApp</label>
        <select id="wa-channel" value={data.channelId ?? ""} onChange={(e) => set({ channelId: e.target.value })} className={inputClass}>
          <option value="">{channels === null && !failed ? "Cargando…" : "Elegí un canal"}</option>
          {(channels ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {channels !== null && channels.length === 0 && (
          <p role="status" className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
            Conectá un WhatsApp en <Link href="/dashboard/settings/channels" className="underline">Canales</Link> para usar este paso.
          </p>
        )}
        {failed && <p role="alert" className="mt-1.5 text-xs text-destructive">No pude cargar los canales. Volvé a abrir el paso.</p>}
        {!data.channelId && channels !== null && channels.length > 0 && <p className="mt-1.5 text-xs text-muted-foreground">Sin canal el paso no manda nada.</p>}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="wa-text" className={labelClass}>Mensaje</label>
          <FieldEmojiButton targetId="wa-text" value={data.text ?? ""} onChange={(text) => set({ text })} />
        </div>
        <textarea id="wa-text" rows={4} value={data.text ?? ""} onFocus={() => setTarget("text")} onChange={(e) => set({ text: e.target.value })} placeholder="Nuevo lead: {{webhook.body.nombre}}" className={inputClass} />
        <p className="mt-1.5 text-xs text-muted-foreground">Podés usar variables. Si el número es de un contacto marcado «no contactar», no se manda.</p>
      </div>

      <div>
        <label htmlFor="wa-media" className={labelClass}>Archivo por link (opcional)</label>
        <input id="wa-media" type="url" value={data.mediaUrl ?? ""} onChange={(e) => set({ mediaUrl: e.target.value })} placeholder="https://…/archivo.pdf" className={inputClass} />
        {(data.mediaUrl ?? "").trim() && (
          <select aria-label="Tipo de archivo" value={data.mediaType ?? "image"} onChange={(e) => set({ mediaType: e.target.value })} className={`${inputClass} mt-2`}>
            <option value="image">Imagen</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="document">Documento</option>
          </select>
        )}
      </div>

      {availableVariables && availableVariables.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground/70">Tocá una variable para agregarla {target === "toVariable" && mode === "variable" ? "al número" : "al mensaje"}.</p>
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
