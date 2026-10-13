"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { ignoreTouchMeta, linkTouchToMeta, searchMetaCatalog, unlinkTouchMeta, type CatalogOption } from "@/lib/actions/meta-match";
import { UNLINKED_DAYS, type UnlinkedRow, type UnlinkedView } from "@/lib/attribution/unlinked-view";
import type { UnlinkedPage } from "@/lib/attribution/unlinked-load";

/**
 * «Sin vincular»: la lista y sus acciones. Lo que se muestra lo arma `lib/attribution/unlinked-view.ts`; esto
 * solo lo compone y llama a las Server Actions (que vuelven a chequear permiso, workspace y visibilidad).
 */

const LEVEL_LABEL = { ad: "Anuncio", adset: "Conjunto", campaign: "Campaña" } as const;

export function UnlinkedList({ data, view, days, canManage }: { data: UnlinkedPage; view: UnlinkedView; days: number; canManage: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [linking, setLinking] = useState<UnlinkedRow | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) (v === null ? sp.delete(k) : sp.set(k, v));
    router.push(`${pathname}?${sp.toString()}`);
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? { tone: "ok", text: ok } : { tone: "error", text: result.error ?? "No pude hacer el cambio." });
      if (result.ok) router.refresh();
    });

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Vista" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {(
            [
              ["sin-vincular", `Sin vincular · ${data.counts.unmatched}`],
              ["manuales", `Hechos a mano · ${data.counts.manual}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => go({ vista: key === "sin-vincular" ? null : key, pagina: null })}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Período
          <select
            value={days}
            onChange={(e) => go({ dias: e.target.value === "90" ? null : e.target.value, pagina: null })}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground"
          >
            {UNLINKED_DAYS.map((d) => (
              <option key={d} value={d}>
                Últimos {d} días
              </option>
            ))}
          </select>
        </label>
      </div>

      {message && (
        <p role="status" className={`rounded-lg border p-3 text-sm ${message.tone === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-emerald-500/30 bg-emerald-500/5"}`}>
          {message.text}
        </p>
      )}

      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {view === "sin-vincular"
            ? `No hay toques sin vincular en los últimos ${days} días. Cada contacto que llega de un anuncio queda asociado solo a su campaña; lo que no se puede aparece acá.`
            : `Todavía no vinculaste ni ignoraste ningún toque a mano en los últimos ${days} días.`}
        </div>
      ) : (
        <ul className="space-y-2">
          {data.rows.map((row) => (
            <li key={row.touchId} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <Link href={`/dashboard/contacts/${row.contactId}`} className="text-sm font-medium underline-offset-2 hover:underline">
                  {row.contactName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {row.when} · {row.origin}
                </span>
                {row.status === "manual" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Vinculado a mano</span>}
                {row.status === "ignored" && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Ignorado</span>}
              </div>

              {row.values.length > 0 && (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {row.values.map((v) => (
                    <div key={v.label} className="flex min-w-0 gap-1.5">
                      <dt className="shrink-0 text-muted-foreground">{v.label}</dt>
                      <dd className="min-w-0 break-all font-mono">{v.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {row.reasons.map((reason) => (
                <p key={reason} className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {reason}
                </p>
              ))}
              {row.chosen && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Elegido: {[row.chosen.adId && `anuncio ${row.chosen.adId}`, row.chosen.adsetId && `conjunto ${row.chosen.adsetId}`, row.chosen.campaignId && `campaña ${row.chosen.campaignId}`].filter(Boolean).join(" › ")}
                </p>
              )}

              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.status === "unmatched" ? (
                    <>
                      <button type="button" onClick={() => setLinking(row)} disabled={pending} className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
                        Vincular
                      </button>
                      <button type="button" onClick={() => act(() => ignoreTouchMeta(row.touchId), "Listo, ese toque no se va a vincular con ningún anuncio.")} disabled={pending} className="h-8 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-60">
                        Ignorar
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => act(() => unlinkTouchMeta(row.touchId), row.status === "ignored" ? "Listo, ese toque vuelve a vincularse solo." : "Listo, el toque vuelve a vincularse solo.")} disabled={pending} className="h-8 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-60">
                      {row.status === "ignored" ? "Dejar de ignorar" : "Quitar vínculo manual"}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Paginas" className="flex items-center justify-between text-xs text-muted-foreground">
          <button type="button" disabled={data.page <= 1} onClick={() => go({ pagina: data.page - 1 > 1 ? String(data.page - 1) : null })} className="h-8 rounded-lg border border-border px-3 hover:bg-accent disabled:opacity-50">
            Anterior
          </button>
          <span>
            Página {data.page} de {pages}
          </span>
          <button type="button" disabled={data.page >= pages} onClick={() => go({ pagina: String(data.page + 1) })} className="h-8 rounded-lg border border-border px-3 hover:bg-accent disabled:opacity-50">
            Siguiente
          </button>
        </nav>
      )}

      {linking && (
        <Sheet title="Vincular con un anuncio" onClose={() => setLinking(null)}>
          <LinkPicker
            row={linking}
            onPick={(option) =>
              startTransition(async () => {
                const input = { touchId: linking.touchId, ...(option.level === "ad" ? { adId: option.id } : option.level === "adset" ? { adsetId: option.id } : { campaignId: option.id }) };
                const result = await linkTouchToMeta(input);
                setLinking(null);
                setMessage(result.ok ? { tone: "ok", text: "Listo, el toque quedó vinculado." } : { tone: "error", text: result.error });
                if (result.ok) router.refresh();
              })
            }
          />
        </Sheet>
      )}
    </div>
  );
}

/**
 * El buscador de anuncio, conjunto o campaña (por nombre o por id). La busqueda corre despues de 250 ms sin
 * escribir; lo que se muestra se deriva del ultimo resultado (no se hace `setState` dentro del efecto de
 * entrada): con menos de 2 letras no hay nada que buscar y se muestra la ayuda.
 */
function LinkPicker({ row, onPick }: { row: UnlinkedRow; onPick: (option: CatalogOption) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ query: string; options: CatalogOption[]; failed: boolean } | null>(null);

  const query = text.trim();
  const enough = query.length >= 2;

  useEffect(() => {
    if (!enough) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchMetaCatalog(query);
      if (!cancelled) setResult({ query, options: found.ok ? found.options : [], failed: !found.ok });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enough]);

  const current = enough && result?.query === query ? result : null;
  const searching = enough && !current;

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-muted-foreground">
        {row.contactName} · {row.when} · {row.origin}
      </p>
      <label className="relative block">
        <span className="sr-only">Buscar anuncio, conjunto o campaña</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nombre o id (mínimo 2 letras)"
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </label>
      <p className="text-[11px] text-muted-foreground">Elegir un anuncio completa su conjunto y su campaña.</p>

      {current?.failed && <p className="text-xs text-destructive">No pude buscar. Probá de nuevo.</p>}
      {searching && <p className="text-xs text-muted-foreground">Buscando…</p>}
      {current && !current.failed && current.options.length === 0 && (
        <p className="text-xs text-muted-foreground">No encontré nada con eso. Si el anuncio es muy nuevo, sincronizá la cuenta y probá de nuevo.</p>
      )}

      <ul className="space-y-1.5">
        {(current?.options ?? []).map((option) => (
          <li key={`${option.level}:${option.id}`}>
            <button type="button" onClick={() => onPick(option)} className="w-full rounded-lg border border-border p-2.5 text-left hover:bg-accent">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{LEVEL_LABEL[option.level]}</span>
              <span className="block text-sm font-medium">{option.name ?? option.id}</span>
              <span className="block text-[11px] text-muted-foreground">
                {option.id}
                {option.path ? ` · ${option.path}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
