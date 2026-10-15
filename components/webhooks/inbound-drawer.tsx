"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/sheet";
import { getWebhookInboundDetail, reprocessWebhookInbounds, saveWebhookSampleFromHistory } from "@/lib/actions/webhook-endpoints";
import type { InboundDetailData } from "@/lib/webhooks/action-types";
import type { FlowResult, InboundResult } from "@/lib/webhooks/types";
import { JsonTree } from "./json-tree";
import { StatusChip } from "./status-chip";
import { ReprocessConfirm } from "./reprocess-confirm";
import { reprocessDone } from "@/lib/webhooks/reprocess-copy";

/** El detalle de un envío: pestaña Datos (payload y query) y pestaña Resultado (por flujo). */
export function InboundDrawer({ endpointId, inboundId, timeZone, onClose, onChanged }: {
  endpointId: string; inboundId: string; timeZone: string; onClose: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<InboundDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"data" | "result">("data");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getWebhookInboundDetail(inboundId).then((res) => {
      if (cancelled) return;
      if (res.ok) setDetail(res.detail);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [inboundId]);

  function reprocess(rerunCompleted: boolean) {
    if (!detail) return;
    setConfirming(false);
    start(async () => {
      const res = await reprocessWebhookInbounds([{ id: detail.id, reprocessCount: detail.reprocessCount }], { rerunCompleted });
      if (!res.ok) return setError(res.error);
      setNotice(reprocessDone({ reprocessed: res.reprocessed, skipped: res.skipped, rerunCompleted }));
      onChanged();
      const fresh = await getWebhookInboundDetail(inboundId);
      if (fresh.ok) setDetail(fresh.detail);
    });
  }

  function applyAsSample() {
    if (!detail) return;
    start(async () => {
      const res = await saveWebhookSampleFromHistory(endpointId, detail.id);
      setNotice(res.ok ? "Guardado como ejemplo del endpoint." : res.error);
      if (res.ok) onChanged();
    });
  }

  const result = (detail?.result ?? null) as InboundResult | null;
  const flows = Object.entries(result?.flows ?? {});
  const canReprocess = !!detail && detail.hasPayload && ["error", "paused", "captured", "processed", "ignored"].includes(detail.status);

  return (
    <Sheet title="Detalle del envío" onClose={onClose}>
      <div className="space-y-4 p-4">
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!detail && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {detail && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label={detail.chip.label} tone={detail.chip.tone} />
              <span className="text-xs text-muted-foreground">{new Date(detail.receivedAt).toLocaleString("es", { dateStyle: "medium", timeStyle: "medium", timeZone })}</span>
              {detail.reprocessCount > 0 && <span className="text-xs text-muted-foreground">· reprocesado {detail.reprocessCount} {detail.reprocessCount === 1 ? "vez" : "veces"}</span>}
            </div>
            <p className="text-sm">{detail.resultText}</p>
            {detail.retentionNotice && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{detail.retentionNotice}.</p>}

            <div className="flex flex-wrap gap-2">
              {canReprocess && (
                <button type="button" onClick={() => setConfirming((v) => !v)} aria-expanded={confirming} disabled={pending} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">Reprocesar</button>
              )}
              {detail.hasPayload && (
                <button type="button" onClick={applyAsSample} disabled={pending} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">Usar como ejemplo</button>
              )}
              {detail.contactId && (
                <Link href={`/dashboard/contacts/${detail.contactId}`} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent">Ir al contacto</Link>
              )}
            </div>
            {confirming && canReprocess && (
              <ReprocessConfirm count={1} alreadyProcessed={detail.status === "processed"} pending={pending} onConfirm={reprocess} onCancel={() => setConfirming(false)} />
            )}
            {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}

            <div role="tablist" className="flex gap-1 border-b border-border">
              {(["data", "result"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {t === "data" ? "Datos" : "Resultado"}
                </button>
              ))}
            </div>

            {tab === "data" && (
              <div className="space-y-4">
                {detail.payload ? (
                  <section aria-label="Payload"><h3 className="mb-1 text-xs font-semibold text-muted-foreground">Datos del envío</h3><JsonTree value={detail.payload} /></section>
                ) : null}
                {detail.query && Object.keys(detail.query).length > 0 && (
                  <section aria-label="Parámetros de la URL"><h3 className="mb-1 text-xs font-semibold text-muted-foreground">Parámetros de la URL</h3><JsonTree value={detail.query} /></section>
                )}
                <p className="text-xs text-muted-foreground">
                  {detail.contentType ?? "sin tipo"} · {detail.sizeBytes ?? 0} bytes{detail.ipPrefix ? ` · desde ${detail.ipPrefix}` : ""}
                </p>
              </div>
            )}

            {tab === "result" && (
              <div className="space-y-4">
                {detail.errorMessage && <p className="text-sm text-red-600 dark:text-red-400">Error: {detail.errorMessage}</p>}
                {flows.length === 0 ? <p className="text-sm text-muted-foreground">{result?.summary ?? "Todavía no corrió ningún flujo con este envío."}</p> : flows.map(([flowId, flow]) => <FlowResultCard key={flowId} flowId={flowId} flow={flow} />)}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

const STATUS_LABEL: Record<FlowResult["status"], string> = {
  completed: "Terminó",
  failed: "Falló",
  skipped_condition: "No cumplió la condición",
  pending: "En curso (esperando)",
};

function FlowResultCard({ flowId, flow }: { flowId: string; flow: FlowResult }) {
  const diff = Object.entries(flow.diff ?? {});
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/dashboard/flows/${flowId}`} className="font-medium hover:underline">{flow.flow_name ?? "Flujo"}</Link>
        <span className={flow.status === "failed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>{STATUS_LABEL[flow.status]}</span>
      </div>
      {flow.contact_result && <p className="mt-1">Contacto {flow.contact_result === "created" ? "creado" : flow.contact_result === "updated" ? "actualizado" : "sin cambios"}{flow.contact_name ? `: ${flow.contact_name}` : ""}</p>}
      {flow.contact_fail_reason && <p className="mt-1 text-amber-700 dark:text-amber-300">Sin contacto ({flow.contact_fail_reason === "no_identifier" ? "el envío no trae teléfono, email ni usuario de red" : flow.contact_fail_reason === "not_found" ? "no existe y el paso solo actualiza" : flow.contact_fail_reason}).</p>}
      {diff.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th scope="col" className="py-1 font-medium">Campo</th><th scope="col" className="py-1 font-medium">Antes</th><th scope="col" className="py-1 font-medium">Después</th></tr></thead>
          <tbody>{diff.map(([field, change]) => (
            <tr key={field} className="border-t border-border"><td className="py-1 pr-2 font-mono">{field}</td><td className="py-1 pr-2 text-muted-foreground">{String(change.before ?? "—")}</td><td className="py-1">{String(change.after ?? "—")}</td></tr>
          ))}</tbody>
        </table>
      )}
      {flow.touch && (
        <p className="mt-2 text-xs text-muted-foreground">
          Toque anotado: <span className="font-medium text-foreground">{flow.touch.source}{flow.touch.medium ? ` · ${flow.touch.medium}` : ""}</span>
          {flow.touch.campaign ? ` · campaña ${flow.touch.campaign}` : ""}{flow.touch.content ? ` · contenido ${flow.touch.content}` : ""}{flow.touch.ad_id ? ` · anuncio ${flow.touch.ad_id}` : ""}
          {flow.touch.recorded ? "" : " (ya estaba anotado)"}
        </p>
      )}
      {flow.notes && flow.notes.length > 0 && <p className="mt-1 text-xs text-muted-foreground">No se pudo guardar: {flow.notes.join(", ")}.</p>}
      {flow.conflict && flow.conflict.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Conflicto: otros datos del envío coinciden con otro contacto. Se usó el principal y no se fusionó nada.</p>}
      {flow.skipped_steps && flow.skipped_steps.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Pasos salteados: no había contacto ({flow.skipped_steps.join(", ")}).</p>}
      {flow.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">Error: {flow.error}</p>}
    </div>
  );
}
