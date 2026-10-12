"use client";

import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { Checkbox, Field, inputClass, Notice } from "@/components/agents/fields";
import { addCustomChannel, applyToAllActive, copyFieldsFrom, toggleChannel, updateChannelFields } from "@/lib/eod/channels";
import { DEFAULT_CHANNEL_SELECTOR } from "@/lib/eod/definition";
import type { EodChannel } from "@/lib/eod/types";
import type { FormDefinition } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";
import { EodFieldsEditor } from "./eod-fields-editor";

/**
 * La pestaña Canales de un EOD de setters (E3). Cada canal se prende o apaga; uno
 * prendido se despliega con sus preguntas. Apagar un canal NO borra sus preguntas.
 * "Copiar preguntas de…" y "Usar en todos los activos" conservan claves y métricas,
 * que es lo que hace que sumen entre canales.
 */
export function ChannelsTab({
  definition,
  onChange,
  disabled,
  neverPublished,
}: {
  definition: FormDefinition;
  onChange: (next: FormDefinition) => void;
  disabled: boolean;
  neverPublished: boolean;
}) {
  const channels = definition.channels ?? [];
  const selector = definition.channelSelector ?? DEFAULT_CHANNEL_SELECTOR;
  const [openKey, setOpenKey] = useState<string | null>(channels.find((c) => c.enabled)?.key ?? null);
  const [newLabel, setNewLabel] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const open = channels.find((c) => c.key === openKey && c.enabled) ?? null;
  const activeOthers = channels.filter((c) => c.enabled && c.key !== open?.key);

  const setChannels = (next: EodChannel[]) => onChange({ ...definition, channels: next });

  function toggle(channel: EodChannel, enabled: boolean) {
    setChannels(toggleChannel(channels, channel.key, enabled));
    if (enabled) setOpenKey(channel.key);
    else if (openKey === channel.key) setOpenKey(null);
  }

  function addCustom() {
    const result = addCustomChannel(channels, newLabel);
    if (!result.ok) return setNewError(result.error);
    setNewError(null);
    setNewLabel("");
    setChannels(result.channels);
    setOpenKey(result.channels[result.channels.length - 1].key);
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">La pregunta de los canales</h2>
        <Field label="Texto de la pregunta">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              disabled={disabled}
              maxLength={200}
              value={selector.label}
              onChange={(e) => onChange({ ...definition, channelSelector: { ...selector, label: e.target.value } })}
            />
          )}
        </Field>
        <Checkbox
          checked={selector.required}
          onChange={(required) => onChange({ ...definition, channelSelector: { ...selector, required } })}
          label="Obligatorio elegir al menos un canal"
        />
      </section>

      <section aria-labelledby="eod-channels-title" className="space-y-3">
        <div>
          <h2 id="eod-channels-title" className="text-sm font-semibold">Canales</h2>
          <p className="text-xs text-muted-foreground">
            Solo los activos aparecen para elegir en el reporte. No hace falta que el canal esté conectado en la app: se puede trabajar LinkedIn a mano.
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <li key={channel.key} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", channel.key === open?.key ? "border-primary bg-primary/5" : "border-border")}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={channel.enabled} disabled={disabled} onChange={(e) => toggle(channel, e.target.checked)} />
                <span className="truncate">{channel.label}</span>
              </label>
              <span className="text-[11px] text-muted-foreground">{channel.fields.length} {channel.fields.length === 1 ? "pregunta" : "preguntas"}</span>
              {channel.enabled && (
                <button type="button" onClick={() => setOpenKey(channel.key)} aria-pressed={channel.key === open?.key} className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent">
                  Editar
                </button>
              )}
            </li>
          ))}
        </ul>
        {!disabled && (
          <div className="flex flex-wrap items-start gap-2">
            <label htmlFor="eod-new-channel" className="sr-only">
              Nombre del canal personalizado
            </label>
            <input
              id="eod-new-channel"
              className={cn(inputClass, "max-w-xs")}
              placeholder="Comunidad de Skool"
              value={newLabel}
              maxLength={60}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <button type="button" onClick={addCustom} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
              <Plus className="h-4 w-4" aria-hidden /> Canal personalizado
            </button>
            {newError && <p className="w-full text-xs text-destructive">{newError}</p>}
          </div>
        )}
      </section>

      {open ? (
        <section aria-labelledby="eod-channel-open" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="eod-channel-open" className="mr-auto text-sm font-semibold">
              Preguntas de {open.label}
            </h2>
            {!disabled && activeOthers.length > 0 && (
              <>
                <label htmlFor="eod-copy-from" className="sr-only">
                  Copiar preguntas de otro canal
                </label>
                <select
                  id="eod-copy-from"
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setChannels(copyFieldsFrom(channels, e.target.value, open.key));
                    setCopied(`Se copiaron las preguntas a ${open.label}.`);
                  }}
                >
                  <option value="">Copiar preguntas de…</option>
                  {channels
                    .filter((c) => c.key !== open.key && c.fields.length > 0)
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={open.fields.length === 0}
                  onClick={() => {
                    setChannels(applyToAllActive(channels, open.key));
                    setCopied(`Las preguntas de ${open.label} quedaron en todos los canales activos.`);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden /> Usar estas preguntas en todos los canales activos
                </button>
              </>
            )}
          </div>
          {copied && (
            <div role="status">
              <Notice tone="success">{copied}</Notice>
            </div>
          )}
          <EodFieldsEditor
            key={open.key}
            label={`Preguntas de ${open.label}`}
            fields={open.fields}
            onChange={(fields) => {
              setCopied(null);
              setChannels(updateChannelFields(channels, open.key, fields));
            }}
            disabled={disabled}
            neverPublished={neverPublished}
            emptyText="Este canal no tiene preguntas. Agregá una o copialas de otro canal."
          />
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Prendé un canal para ver y editar sus preguntas.</p>
      )}
    </div>
  );
}
