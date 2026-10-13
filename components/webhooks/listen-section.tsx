"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Radio } from "lucide-react";
import { pollWebhookSample, saveWebhookSampleFromJson, startWebhookListening, stopWebhookListening } from "@/lib/actions/webhook-endpoints";
import type { EndpointDetail } from "@/lib/webhooks/action-types";
import { isListening } from "@/lib/webhooks/listen";
import { JsonTree } from "./json-tree";

/** Lo que necesita la sección: el endpoint (su id, si está pausado, la escucha y el ejemplo). */
export type ListenEndpoint = Pick<EndpointDetail, "id" | "status" | "listenUntil" | "sample">;

const fmt = (iso: string, timeZone: string) => new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "medium", timeZone });

/** "Escuchar el próximo envío" (15 min, consulta cada 3 s) + el ejemplo guardado. */
export function ListenSection({ endpoint, timeZone, onChanged, compact = false }: { endpoint: ListenEndpoint; timeZone: string; onChanged: () => void; /** En el panel del editor: sin el recuadro de la pantalla. */ compact?: boolean }) {
  const [listenUntil, setListenUntil] = useState<string | null>(endpoint.listenUntil);
  const [now, setNow] = useState(() => Date.now());
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const baseline = useRef(endpoint.sample?.captured_at ?? null);

  const listening = isListening(new Date(now), listenUntil);

  useEffect(() => {
    if (!listening) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const res = await pollWebhookSample(endpoint.id);
      if (res.ok && res.sampleCapturedAt && res.sampleCapturedAt !== baseline.current) {
        baseline.current = res.sampleCapturedAt;
        setListenUntil(null);
        onChanged();
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [listening, endpoint.id, onChanged]);

  const secondsLeft = listening && listenUntil ? Math.max(0, Math.floor((new Date(listenUntil).getTime() - now) / 1000)) : 0;
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const expired = !listening && listenUntil !== null;

  return (
    <section aria-labelledby="wh-sample" className={compact ? "space-y-1" : "rounded-xl border border-border bg-card p-4"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="wh-sample" className="mr-auto text-sm font-semibold">Ejemplo de un envío</h2>
        {listening ? (
          <>
            <span role="timer" className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-300"><Radio className="h-4 w-4 animate-pulse" aria-hidden /> Escuchando… {clock}</span>
            <button type="button" onClick={() => start(async () => { await stopWebhookListening(endpoint.id); setListenUntil(null); })} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">Dejar de escuchar</button>
          </>
        ) : (
          <button type="button" disabled={pending || endpoint.status === "paused"} onClick={() => start(async () => { setError(null); const r = await startWebhookListening(endpoint.id); if (r.ok) { setListenUntil(r.listenUntil); setNow(Date.now()); } else setError(r.error); })} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
            Escuchar el próximo envío
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Mandá un envío de prueba desde tu formulario: lo guardamos como ejemplo para armar el mapeo, sin correr ningún flujo. Escucha 15 minutos.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {endpoint.sample ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">Capturado el {fmt(endpoint.sample.captured_at, timeZone)}</p>
          <JsonTree value={endpoint.sample.payload} />
          {endpoint.sample.query && Object.keys(endpoint.sample.query).length > 0 && (<><p className="text-xs font-semibold text-muted-foreground">Parámetros de la URL</p><JsonTree value={endpoint.sample.query} /></>)}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Todavía no hay un ejemplo. Escuchá un envío, pegá un JSON o usá uno del historial.</p>
      )}

      {(expired || !listening) && (
        <details className="mt-3 text-sm" open={expired}>
          <summary className="cursor-pointer text-xs font-medium text-primary">{expired ? "No llegó nada en 15 minutos: pegá un JSON de ejemplo" : "Pegar un JSON de ejemplo a mano"}</summary>
          <textarea aria-label="JSON de ejemplo" value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder='{"email": "ana@mail.com", "name": "Ana"}' className="mt-2 w-full rounded-lg border border-border bg-background p-2 font-mono text-xs" />
          <button type="button" disabled={pending || !paste.trim()} onClick={() => start(async () => { setError(null); const r = await saveWebhookSampleFromJson(endpoint.id, paste); if (!r.ok) setError(r.error); else { setPaste(""); setListenUntil(null); onChanged(); } })} className="mt-2 h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">Guardar como ejemplo</button>
          <p className="mt-1 text-xs text-muted-foreground">También podés abrir un envío del historial y elegir «Usar como ejemplo».</p>
        </details>
      )}
    </section>
  );
}
