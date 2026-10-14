"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { PathConditions } from "@/components/automations/path-conditions";
import { useConditionCatalog, useConditionGroups } from "@/components/automations/use-condition-catalog";
import { ListenSection } from "@/components/webhooks/listen-section";
import { createWebhookEndpoint } from "@/lib/actions/webhook-endpoints";
import { listWebhookEndpointsForPicker } from "@/lib/actions/webhook-flow-editor";
import type { PickerEndpoint } from "@/lib/webhooks/action-types";
import { parseWebhookTriggerConfig } from "@/lib/webhooks/trigger-config";
import { ONCE_PER_CONTACT_HELP, ONCE_PER_CONTACT_LABEL, oncePerContactHint } from "@/lib/webhooks/once-per-contact";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

/**
 * El panel del disparador «Webhook recibido» (F9, F11): elegir o crear el endpoint, copiar su URL,
 * escuchar un envío de prueba (queda como ejemplo y no corre ningún flujo) y el «Solo si…» con el mismo
 * editor que Condiciones. Solo lo ve quien tiene `flows.edit` (la URL es una credencial).
 */
export function WebhookTriggerPanel({ flowId, data, onChange, sendsMessages = false }: { flowId?: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void; sendsMessages?: boolean }) {
  const config = parseWebhookTriggerConfig(data);
  const oncePerContact = config.oncePerContact;
  const hint = oncePerContactHint({ enabled: oncePerContact, sendsMessages });
  const [endpoints, setEndpoints] = useState<PickerEndpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const reload = useCallback(async () => {
    const res = await listWebhookEndpointsForPicker();
    if (res.ok) setEndpoints(res.endpoints);
    else setError(res.error);
  }, []);

  useEffect(() => {
    let alive = true;
    listWebhookEndpointsForPicker().then((res) => {
      if (!alive) return;
      if (res.ok) setEndpoints(res.endpoints);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const selected = endpoints?.find((e) => e.id === config.endpointId) ?? null;

  const { inputs, error: catalogError } = useConditionCatalog(flowId ?? "", data);
  const groups = useConditionGroups(inputs, []);
  const conditionPath = useMemo(() => ({ logic: config.conditions?.logic ?? ("and" as const), conditions: config.conditions?.conditions ?? [] }), [config.conditions]);

  function pick(id: string) {
    onChange({ ...data, endpointId: id || undefined });
  }

  function create() {
    setError(null);
    start(async () => {
      const res = await createWebhookEndpoint({ name: newName });
      if (!res.ok) return setError(res.error);
      setNewName("");
      setCreating(false);
      await reload();
      onChange({ ...data, endpointId: res.endpointId });
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No pude copiar. Seleccioná la dirección y copiala a mano.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="wh-trigger-endpoint" className="mb-1 block text-xs font-semibold text-foreground">Endpoint</label>
        {endpoints === null ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : (
          <select id="wh-trigger-endpoint" value={config.endpointId ?? ""} onChange={(e) => (e.target.value === "__new" ? setCreating(true) : pick(e.target.value))} className={inputClass}>
            <option value="">Elegí un endpoint…</option>
            {endpoints.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status === "paused" ? " (pausado)" : ""}</option>)}
            <option value="__new">+ Nuevo endpoint</option>
          </select>
        )}
        {creating && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <input aria-label="Nombre del nuevo endpoint" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Typeform de la landing" maxLength={120} className={inputClass} />
            <button type="submit" disabled={pending || !newName.trim()} className="h-9 shrink-0 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50">Crear</button>
          </form>
        )}
        {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
        {!config.endpointId && !creating && endpoints !== null && <p className="mt-1 text-xs text-muted-foreground">Creá o elegí un endpoint para recibir los datos.</p>}
      </div>

      {selected && (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">URL para tu formulario externo</label>
            <div className="flex gap-1.5">
              <input readOnly aria-label="URL del endpoint" value={selected.url} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-xs`} />
              <button type="button" onClick={() => copy(selected.url)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-xs hover:bg-accent">
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? "Copiada" : "Copiar"}
              </button>
            </div>
            {selected.urlIsLocal && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Dirección local: un formulario externo no la alcanza. Falta configurar NEXT_PUBLIC_APP_URL.</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {selected.lastReceivedAt ? `Último envío: ${new Date(selected.lastReceivedAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}.` : "Todavía no llegó ningún envío."}{" "}
              <Link href={`/dashboard/settings/integrations/webhooks/${selected.id}`} className="font-medium text-emerald-700 hover:underline dark:text-emerald-300">Ver historial</Link>
            </p>
          </div>

          <ListenSection compact endpoint={{ id: selected.id, status: selected.status, listenUntil: selected.listenUntil, sample: selected.sample }} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"} onChanged={reload} />

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-foreground">Solo si…</legend>
            <p className="text-xs text-muted-foreground">Corre únicamente cuando el envío cumple estas condiciones (si no, no corre y el historial lo dice). Sin condiciones, corre siempre.</p>
            {catalogError && <p className="text-xs text-red-600">{catalogError}</p>}
            {inputs || catalogError ? (
              <PathConditions
                path={conditionPath}
                groups={groups}
                onChange={(next) => onChange({ ...data, conditions: next.conditions.length > 0 ? { logic: next.logic, conditions: next.conditions } : undefined })}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Cargando los campos…</p>
            )}
            {!selected.sample && <p className="text-xs text-muted-foreground">Escuchá un envío de prueba para ver los campos del formulario y compararlos.</p>}
          </fieldset>

          <div className="space-y-1 rounded-lg border border-border p-3">
            <label className="flex items-start gap-2 text-xs font-semibold text-foreground">
              <input type="checkbox" checked={oncePerContact} onChange={(e) => onChange({ ...data, oncePerContact: e.target.checked ? true : undefined })} className="mt-0.5 size-4 shrink-0" />
              <span>{ONCE_PER_CONTACT_LABEL}</span>
            </label>
            <p className="text-xs text-muted-foreground">{ONCE_PER_CONTACT_HELP}</p>
            {hint && <p role="note" className="text-xs text-amber-700 dark:text-amber-300">{hint}</p>}
          </div>
        </>
      )}
    </div>
  );
}
