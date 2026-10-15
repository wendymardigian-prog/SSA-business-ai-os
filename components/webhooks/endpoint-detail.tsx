"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  deleteWebhookEndpoint, generateWebhookSecret, regenerateWebhookToken, removeWebhookSecret,
  reprocessWebhookInbounds, setWebhookEndpointStatus, updateWebhookEndpoint,
} from "@/lib/actions/webhook-endpoints";
import type { EndpointDetail, InboundListItem } from "@/lib/webhooks/action-types";
import { InboundDrawer } from "./inbound-drawer";
import { StatusChip } from "./status-chip";
import { ListenSection } from "./listen-section";
import { ReprocessConfirm } from "./reprocess-confirm";
import { reprocessDone } from "@/lib/webhooks/reprocess-copy";

const STATUS_FILTERS = [
  ["all", "Todos"], ["received", "Recibidos"], ["processed", "Procesados"], ["error", "Con error"],
  ["ignored", "Ignorados"], ["captured", "Capturados"], ["paused", "Pausados"],
] as const;

const fmt = (iso: string, timeZone: string) => new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "medium", timeZone });

export function EndpointDetailScreen({ endpoint, history, filters, timeZone }: {
  endpoint: EndpointDetail;
  history: { items: InboundListItem[]; total: number; page: number; pageSize: number };
  filters: { status: string; from: string; to: string };
  timeZone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setMessage({ tone: "error", text: res.error ?? "No se pudo." });
      if (okText) setMessage({ tone: "ok", text: okText });
      after?.();
      router.refresh();
    });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ tone: "error", text: "No pude copiar. Seleccioná la dirección y copiala a mano." });
    }
  }

  function setFilter(next: Partial<typeof filters>) {
    const params = new URLSearchParams();
    const merged = { ...filters, ...next };
    if (merged.status && merged.status !== "all") params.set("estado", merged.status);
    if (merged.from) params.set("desde", merged.from);
    if (merged.to) params.set("hasta", merged.to);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function reprocessSelected(rerunCompleted: boolean) {
    const items = history.items.filter((i) => selected.has(i.id)).map((i) => ({ id: i.id, reprocessCount: i.reprocessCount }));
    setConfirming(false);
    if (items.length === 0) return;
    start(async () => {
      const res = await reprocessWebhookInbounds(items, { rerunCompleted });
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      setMessage({ tone: "ok", text: reprocessDone({ reprocessed: res.reprocessed, skipped: res.skipped, rerunCompleted }) });
      setSelected(new Set());
      router.refresh();
    });
  }

  const totalPages = Math.max(1, Math.ceil(history.total / history.pageSize));
  const goPage = (page: number) => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    params.set("pagina", String(page));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={endpoint.name}
        tooltip="La URL de este endpoint, lo que llegó y lo que pasó con cada envío."
        backHref={<Link href="/dashboard/settings/integrations/webhooks" className="mr-1 text-sm text-muted-foreground hover:text-foreground" aria-label="Volver a Webhooks entrantes">←</Link>}
        right={
          <button type="button" disabled={pending} onClick={() => run(() => setWebhookEndpointStatus(endpoint.id, endpoint.status === "active" ? "paused" : "active"))} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
            {endpoint.status === "active" ? "Pausar" : "Reanudar"}
          </button>
        }
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {message && <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${message.tone === "error" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{message.text}</p>}

          {/* URL */}
          <section aria-labelledby="wh-url" className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="wh-url" className="text-sm font-semibold">URL del endpoint</h2>
              {endpoint.status === "paused" ? <StatusChip label="Pausado" tone="neutral" /> : <StatusChip label="Activo" tone="success" />}
            </div>
            <div className="mt-2 flex gap-2">
              <input readOnly aria-label="URL del endpoint" value={endpoint.url} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-xs" />
              <button type="button" onClick={() => copy(endpoint.url)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copiada" : "Copiar"}
              </button>
            </div>
            {endpoint.urlIsLocal && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Esta dirección es local: un formulario externo no la va a alcanzar. Configurá <code>NEXT_PUBLIC_APP_URL</code> con el dominio público.</p>}
            <p className="mt-2 text-xs text-muted-foreground">Pegala en el formulario externo como URL del webhook (método POST). La URL es una credencial: quien la tiene puede mandar datos acá.</p>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <button type="button" disabled={pending} onClick={() => setEditing(!editing)} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">Editar</button>
              <button type="button" disabled={pending} onClick={() => { if (window.confirm("La URL vieja deja de funcionar ya. Tenés que pegar la nueva en el formulario externo.\n\n¿Regenerar?")) run(() => regenerateWebhookToken(endpoint.id), "URL regenerada. Copiá la nueva."); }} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">Regenerar URL</button>
              <button type="button" disabled={pending} onClick={() => run(async () => { const r = await generateWebhookSecret(endpoint.id); if (r.ok) setNewSecret(r.secret); return r; })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                <KeyRound className="h-3.5 w-3.5" aria-hidden /> {endpoint.hasSecret ? "Cambiar el secreto" : "Pedir un secreto en el header"}
              </button>
              {endpoint.hasSecret && <button type="button" disabled={pending} onClick={() => run(() => removeWebhookSecret(endpoint.id), "Secreto quitado.", () => setNewSecret(null))} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">Quitar el secreto</button>}
              <button type="button" disabled={pending} onClick={() => { if (window.confirm("¿Borrar este endpoint? Los envíos viejos dejan de verse.")) run(() => deleteWebhookEndpoint(endpoint.id), undefined, () => router.push("/dashboard/settings/integrations/webhooks")); }} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg border border-red-500/40 px-3 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Borrar
              </button>
            </div>
            {endpoint.hasSecret && !newSecret && <p className="mt-2 text-xs text-muted-foreground">Este endpoint exige el header <code>x-webhook-secret</code>. Sin él (o con otro valor) rechaza el envío.</p>}
            {newSecret && (
              <div role="status" className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">Copiá el secreto ahora: no lo vas a poder ver de nuevo.</p>
                <p className="mt-1 break-all font-mono text-xs">{newSecret}</p>
                <p className="mt-1 text-xs text-muted-foreground">Mandalo en el header <code>x-webhook-secret</code> de cada envío.</p>
                <button type="button" onClick={() => copy(newSecret)} className="mt-2 h-7 rounded-lg border border-border px-2 text-xs hover:bg-accent">Copiar secreto</button>
                <button type="button" onClick={() => setNewSecret(null)} className="ml-2 h-7 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent">Ya lo copié</button>
              </div>
            )}
            {editing && <EditForm endpoint={endpoint} onDone={() => { setEditing(false); router.refresh(); }} />}
          </section>

          {/* Escuchar / ejemplo */}
          <ListenSection endpoint={endpoint} timeZone={timeZone} onChanged={() => router.refresh()} />

          {/* Historial */}
          <section aria-labelledby="wh-history" className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
              <h2 id="wh-history" className="mr-auto text-sm font-semibold">Historial <span className="font-normal text-muted-foreground">({history.total})</span></h2>
              <label className="text-xs text-muted-foreground">Estado
                <select value={filters.status || "all"} onChange={(e) => setFilter({ status: e.target.value })} className="ml-1 h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground">
                  {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">Desde <input type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} className="ml-1 h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground" /></label>
              <label className="text-xs text-muted-foreground">Hasta <input type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} className="ml-1 h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground" /></label>
              <button type="button" disabled={selected.size === 0 || pending} onClick={() => setConfirming((v) => !v)} aria-expanded={confirming} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-40">Reprocesar ({selected.size})</button>
            </div>
            {confirming && selected.size > 0 && (
              <div className="border-b border-border p-4">
                <ReprocessConfirm count={selected.size} pending={pending} onConfirm={reprocessSelected} onCancel={() => setConfirming(false)} />
              </div>
            )}

            {history.items.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">{filters.status !== "all" || filters.from || filters.to ? "No hay envíos con esos filtros." : "Todavía no llegó ningún envío a este endpoint."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-border text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-10 px-4 py-2"><span className="sr-only">Elegir</span></th>
                      <th scope="col" className="px-2 py-2 font-medium">Fecha</th>
                      <th scope="col" className="px-2 py-2 font-medium">Estado</th>
                      <th scope="col" className="px-2 py-2 font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.items.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-2">
                          <input type="checkbox" aria-label={`Elegir el envío del ${fmt(item.receivedAt, timeZone)}`} checked={selected.has(item.id)} disabled={selected.size >= 100 && !selected.has(item.id)}
                            onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
                        </td>
                        <td className="whitespace-nowrap px-2 py-2"><button type="button" onClick={() => setDrawerId(item.id)} className="text-left hover:underline">{fmt(item.receivedAt, timeZone)}</button></td>
                        <td className="px-2 py-2"><StatusChip label={item.chip.label} tone={item.chip.tone} /></td>
                        <td className="max-w-md truncate px-2 py-2 text-muted-foreground">{item.resultText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <nav aria-label="Páginas del historial" className="flex items-center justify-between border-t border-border px-4 py-2 text-sm">
                <button type="button" disabled={history.page <= 1} onClick={() => goPage(history.page - 1)} className="h-8 rounded-lg border border-border px-3 hover:bg-accent disabled:opacity-40">Anterior</button>
                <span className="text-xs text-muted-foreground">Página {history.page} de {totalPages}</span>
                <button type="button" disabled={history.page >= totalPages} onClick={() => goPage(history.page + 1)} className="h-8 rounded-lg border border-border px-3 hover:bg-accent disabled:opacity-40">Siguiente</button>
              </nav>
            )}
          </section>
        </div>
      </div>

      {drawerId && <InboundDrawer endpointId={endpoint.id} inboundId={drawerId} timeZone={timeZone} onClose={() => setDrawerId(null)} onChanged={() => router.refresh()} />}
    </div>
  );
}

function EditForm({ endpoint, onDone }: { endpoint: EndpointDetail; onDone: () => void }) {
  const [name, setName] = useState(endpoint.name);
  const [description, setDescription] = useState(endpoint.description ?? "");
  const [eventIdPath, setEventIdPath] = useState(endpoint.eventIdPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="mt-3 space-y-3 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => { const r = await updateWebhookEndpoint(endpoint.id, { name, description, eventIdPath }); if (!r.ok) setError(r.error); else onDone(); }); }}>
      <div><label htmlFor="wh-e-name" className="text-xs font-medium">Nombre</label><input id="wh-e-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" /></div>
      <div><label htmlFor="wh-e-desc" className="text-xs font-medium">Descripción</label><textarea id="wh-e-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
      <div><label htmlFor="wh-e-path" className="text-xs font-medium">Ruta del id del envío</label><input id="wh-e-path" value={eventIdPath} onChange={(e) => setEventIdPath(e.target.value)} placeholder="event_id" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm" /></div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={pending} className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Guardando…" : "Guardar"}</button>
    </form>
  );
}
