"use client";

/**
 * Pestaña Generaciones de una plantilla (F53, F54).
 *
 * Filtros (Todas · Generadas · Fallidas · En proceso · Anuladas) con contadores, búsqueda por nombre o código, «Reintentar
 * las fallidas (N)», «Generar para varios…» y «Emitir <tipo>»; una tabla (en el celular, tarjetas con las acciones en un
 * menú) con Ver, copiar link, Anular, Volver a generar, Reintentar y Detalle. Mientras haya algo «En proceso» se vuelve a
 * leer sola cada 5 segundos. La pestaña, el filtro, la búsqueda y la página viven en la URL
 * (`?tab=generaciones&estado=…&q=…&pagina=…`). Todo lo que decide la pantalla sale de `lib/designer/screens/generations.ts`.
 * Lo que el permiso no da se OCULTA.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Link2, Loader2, MoreHorizontal, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Popover } from "@/components/ui/popover";
import { secondaryButton, primaryButton, smallButton, inputClass } from "@/components/designer/editor/overlays";
import { useUrlParam } from "@/components/designer/editor/use-url-param";
import { regenerate, retryFailedGenerations, retryGeneration } from "@/lib/actions/designer/generate";
import { listGenerations } from "@/lib/actions/designer/generations";
import type { GenerationsTabProps } from "@/lib/designer/contracts";
import type { GenerationListView } from "@/lib/designer/generations-query";
import {
  emptyMessage,
  GENERATION_FILTER_LABELS,
  GENERATION_FILTERS,
  GENERATIONS_POLL_MS,
  generationFiltersToQuery,
  parseGenerationFilters,
  regenerateMessage,
  retryAllLabel,
  withGenerationFilter,
  type GenerationFilters,
  type RowAction,
  type StateTone,
} from "@/lib/designer/screens/generations";
import { cn } from "@/lib/utils";
import { DetailDialog, RetryDataDialog, VoidDialog } from "./generation-dialogs";
import { GENERATIONS_CHANGED } from "./events";
import { GenerateManyModal } from "./generate-many-modal";
import { GenerateOneModal } from "./generate-one-modal";

type Row = GenerationListView["rows"][number];
type Notice = { tone: "ok" | "error"; text: string } | null;
type Dialog =
  | { kind: "void"; row: Row }
  | { kind: "regenerate"; row: Row }
  | { kind: "detail"; row: Row }
  | { kind: "retry-data"; row: Row; needs: { key: string; label: string }[] }
  | null;

const TONE: Record<StateTone, string> = {
  ok: "bg-good/15 text-good",
  bad: "bg-bad/15 text-bad",
  act: "bg-primary/15 text-primary-ink",
  off: "bg-muted text-muted-foreground",
};

const ACTION_LABELS: Record<RowAction, string> = {
  view: "Ver",
  copy_link: "Copiar link",
  void: "Anular",
  regenerate: "Volver a generar",
  retry: "Reintentar",
  detail: "Detalle",
};

export function GenerationsTab({ templateId, can }: GenerationsTabProps) {
  const [estadoParam, setEstado] = useUrlParam("estado");
  const [qParam, setQ] = useUrlParam("q");
  const [paginaParam, setPagina] = useUrlParam("pagina");
  const filters = parseGenerationFilters({ estado: estadoParam ?? undefined, q: qParam ?? undefined, pagina: paginaParam ?? undefined });
  const filtersKey = generationFiltersToQuery(filters);

  const [view, setView] = useState<GenerationListView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [modal, setModal] = useState<"one" | "many" | null>(null);
  const [search, setSearch] = useState(filters.q);
  const request = useRef(0);

  const load = useCallback(
    async (current: GenerationFilters) => {
      const mine = ++request.current;
      try {
        const res = await listGenerations({ templateId, estado: current.estado, q: current.q, pagina: current.page });
        if (mine !== request.current) return;
        if (res.ok) {
          setView(res.data);
          setError(null);
        } else setError(res.error);
      } catch {
        if (mine === request.current) setError("No pudimos cargar las generaciones. Revisá tu conexión y probá de nuevo.");
      }
    },
    [templateId],
  );

  // Se lee al abrir y cada vez que cambia el filtro, la búsqueda o la página.
  useEffect(() => {
    void load(parseGenerationFilters(new URLSearchParams(filtersKey)));
  }, [load, filtersKey]);

  // Los modales de generar avisan cuando terminan: se vuelve a leer sin esperar.
  useEffect(() => {
    const onChanged = () => void load(parseGenerationFilters(new URLSearchParams(filtersKey)));
    window.addEventListener(GENERATIONS_CHANGED, onChanged);
    return () => window.removeEventListener(GENERATIONS_CHANGED, onChanged);
  }, [load, filtersKey]);

  // Mientras haya algo «En proceso», cada 5 s (y solo con la pestaña a la vista).
  const polling = view?.polling === true;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(parseGenerationFilters(new URLSearchParams(filtersKey)));
    }, GENERATIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, load, filtersKey]);

  // La búsqueda se escribe en la URL un momento después de dejar de tipear.
  useEffect(() => {
    if (search.trim() === filters.q) return;
    const timer = setTimeout(() => {
      setQ(search.trim() || null, "replace");
      setPagina(null, "replace");
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filters.q, setQ, setPagina]);

  function applyFilters(next: GenerationFilters) {
    setEstado(next.estado === "todas" ? null : next.estado, "replace");
    setPagina(next.page > 1 ? String(next.page) : null, "replace");
  }

  const refresh = () => load(filters);
  const who = (row: Row) => row.para.name;
  const done = (text: string) => {
    setDialog(null);
    setNotice({ tone: "ok", text });
    void refresh();
  };

  async function copy(row: Row) {
    if (!row.link) return;
    try {
      await navigator.clipboard.writeText(row.link);
      setNotice({ tone: "ok", text: "Link copiado." });
    } catch {
      setNotice({ tone: "error", text: "No se pudo copiar. Abrí el link y copialo desde el navegador." });
    }
  }

  async function retry(row: Row) {
    setBusyRow(row.id);
    setNotice(null);
    try {
      const res = await retryGeneration({ designId: row.id });
      if (!res.ok) setNotice({ tone: "error", text: res.error });
      else if (res.data.needs && res.data.needs.length > 0) setDialog({ kind: "retry-data", row, needs: res.data.needs });
      else {
        setNotice({ tone: "ok", text: `Se vuelve a generar la pieza de ${who(row)}.` });
        void refresh();
      }
    } catch {
      setNotice({ tone: "error", text: "No se pudo reintentar. Revisá tu conexión y probá de nuevo." });
    } finally {
      setBusyRow(null);
    }
  }

  async function retryAll() {
    setRetryingAll(true);
    setNotice(null);
    try {
      const res = await retryFailedGenerations({ templateId });
      if (!res.ok) setNotice({ tone: "error", text: res.error });
      else {
        const { retried, needData } = res.data;
        const parts = [retried > 0 ? `Se reintentan ${retried}.` : "No había ninguna para reintentar de una vez.", needData > 0 ? `${needData} ${needData === 1 ? "pide" : "piden"} un dato: reintentalas una por una.` : ""];
        setNotice({ tone: "ok", text: parts.filter(Boolean).join(" ") });
        void refresh();
      }
    } catch {
      setNotice({ tone: "error", text: "No se pudo reintentar. Revisá tu conexión y probá de nuevo." });
    } finally {
      setRetryingAll(false);
    }
  }

  async function runRegenerate(row: Row) {
    setDialog(null);
    setBusyRow(row.id);
    setNotice(null);
    try {
      const res = await regenerate({ designId: row.id });
      if (!res.ok) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: `Se generó una pieza nueva para ${who(row)}.` });
        void refresh();
      }
    } catch {
      setNotice({ tone: "error", text: "No se pudo volver a generar. Revisá tu conexión y probá de nuevo." });
    } finally {
      setBusyRow(null);
    }
  }

  function act(action: RowAction, row: Row) {
    if (action === "copy_link") void copy(row);
    else if (action === "retry") void retry(row);
    else if (action === "void") setDialog({ kind: "void", row });
    else if (action === "regenerate") setDialog({ kind: "regenerate", row });
    else if (action === "detail") setDialog({ kind: "detail", row });
  }

  if (!view) {
    return error ? (
      <div role="alert" className="mx-auto max-w-md space-y-3 rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm">{error}</p>
        <button type="button" className={secondaryButton} onClick={() => void refresh()}>
          Reintentar
        </button>
      </div>
    ) : (
      <div aria-busy="true" aria-label="Cargando las generaciones" className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
    );
  }

  const { counts, template } = view;
  const retryLabel = retryAllLabel(counts.fallidas);
  const noun = template.verify ? template.issueLabel.replace(/^Emitir /, "") : "pieza";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
          {GENERATION_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filters.estado === f}
              onClick={() => applyFilters(withGenerationFilter(filters, { estado: f }))}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium", filters.estado === f ? "border-primary-edge bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {GENERATION_FILTER_LABELS[f]}
              <span className="tabular-nums text-xs text-muted-foreground">{counts[f]}</span>
            </button>
          ))}
        </div>
        {can.generate && (
          <div className="flex flex-wrap gap-2">
            {retryLabel && (
              <button type="button" className={secondaryButton} onClick={() => void retryAll()} disabled={retryingAll}>
                {retryingAll && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {retryLabel}
              </button>
            )}
            <button type="button" className={secondaryButton} onClick={() => setModal("many")}>
              Generar para varios…
            </button>
            <button type="button" className={primaryButton} onClick={() => setModal("one")}>
              {template.issueLabel}
            </button>
          </div>
        )}
      </div>

      <label className="relative block max-w-sm">
        <span className="sr-only">Buscar por nombre o código</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o código…" className={cn(inputClass, "pl-8")} />
      </label>

      {notice && (
        <p role="status" className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", notice.tone === "ok" ? "border-good/40 bg-good/10" : "border-bad/40 bg-bad/10 text-bad")}>
          {notice.tone === "ok" && <Check className="h-4 w-4 shrink-0 text-good" aria-hidden />}
          <span className="min-w-0 flex-1">{notice.text}</span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}

      {view.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">{emptyMessage(filters, counts.todas, template.issueLabel)}</div>
      ) : (
        <>
          {/* Escritorio: tabla */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Cuándo</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Para</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Cómo se generó</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Estado</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground tabular-nums">{row.when}</td>
                    <td className="max-w-[16rem] px-3 py-3">
                      <p className="truncate font-medium">{row.para.name}</p>
                      {row.para.detail && <p className="truncate text-xs text-muted-foreground">{row.para.detail}</p>}
                      <p className="font-mono text-[11px] text-muted-foreground">{row.code}</p>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <Origin row={row} />
                    </td>
                    <td className="px-3 py-3">
                      <StateBadge row={row} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {row.actions.map((a) => (
                          <ActionButton key={a} action={a} row={row} busy={busyRow === row.id} onAct={act} primary={a === "retry"} />
                        ))}
                        {row.processing && <span className="self-center text-xs text-muted-foreground">En cola…</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: una tarjeta por fila, con las acciones en un menú */}
          <ul className="space-y-2 md:hidden">
            {view.rows.map((row) => (
              <li key={row.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.para.name}</p>
                    {row.para.detail && <p className="truncate text-xs text-muted-foreground">{row.para.detail}</p>}
                  </div>
                  <StateBadge row={row} compact />
                  <Popover label={`Acciones de ${row.para.name}`} align="end" panelClassName="w-52 p-1.5" closeOnSelect triggerClassName="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-accent" trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}>
                    <div className="flex flex-col">
                      {row.actions.map((a) =>
                        a === "view" && row.link ? (
                          <a key={a} href={row.link} target="_blank" rel="noopener noreferrer" className="rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
                            {ACTION_LABELS.view}
                          </a>
                        ) : (
                          <button key={a} type="button" disabled={busyRow === row.id} onClick={() => act(a, row)} className="rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50">
                            {ACTION_LABELS[a]}
                          </button>
                        ),
                      )}
                    </div>
                  </Popover>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.when} · <Origin row={row} />
                </p>
                {row.state.reason && <p className={cn("text-xs", row.state.key === "failed" ? "text-bad" : "text-muted-foreground")}>{row.state.reason}</p>}
              </li>
            ))}
          </ul>

          {view.pages > 1 && (
            <nav aria-label="Páginas" className="flex items-center justify-between gap-2 text-sm">
              <button type="button" className={secondaryButton} disabled={view.page <= 1} onClick={() => applyFilters({ ...filters, page: view.page - 1 })}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Anterior
              </button>
              <span className="text-muted-foreground">
                Página {view.page} de {view.pages}
              </span>
              <button type="button" className={secondaryButton} disabled={view.page >= view.pages} onClick={() => applyFilters({ ...filters, page: view.page + 1 })}>
                Siguiente
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </nav>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">Cada fila es una pieza generada desde esta plantilla: a mano, para varios, desde una automatización o desde otro módulo. Si falla, queda acá con el motivo y se puede reintentar.</p>

      {can.generate && (
        <>
          <GenerateOneModal templateId={templateId} open={modal === "one"} onClose={() => setModal(null)} />
          <GenerateManyModal templateId={templateId} open={modal === "many"} onClose={() => setModal(null)} />
        </>
      )}

      {dialog?.kind === "void" && <VoidDialog designId={dialog.row.id} who={who(dialog.row)} noun={noun} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "retry-data" && <RetryDataDialog designId={dialog.row.id} who={who(dialog.row)} needs={dialog.needs} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "detail" && <DetailDialog designId={dialog.row.id} who={who(dialog.row)} onClose={() => setDialog(null)} onChanged={done} />}
      <ConfirmDialog
        open={dialog?.kind === "regenerate"}
        title="Volver a generar"
        message={dialog?.kind === "regenerate" ? regenerateMessage(template, who(dialog.row)) : ""}
        confirmLabel="Volver a generar"
        cancelLabel="Cancelar"
        onConfirm={() => dialog?.kind === "regenerate" && void runRegenerate(dialog.row)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

function Origin({ row }: { row: Row }) {
  return row.origin.href ? (
    <a href={row.origin.href} className="text-primary-ink underline-offset-2 hover:underline">
      {row.origin.text}
    </a>
  ) : (
    <span>{row.origin.text}</span>
  );
}

function StateBadge({ row, compact = false }: { row: Row; compact?: boolean }) {
  return (
    <div className={compact ? "shrink-0" : "max-w-[18rem]"}>
      <span className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", TONE[row.state.tone])}>
        {row.processing && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {row.state.label}
      </span>
      {!compact && row.state.reason && <p className={cn("mt-1 text-xs", row.state.key === "failed" ? "text-bad" : "text-muted-foreground")}>{row.state.reason}</p>}
    </div>
  );
}

function ActionButton({ action, row, busy, onAct, primary }: { action: RowAction; row: Row; busy: boolean; onAct: (action: RowAction, row: Row) => void; primary: boolean }) {
  if (action === "view") {
    return row.link ? (
      <a href={row.link} target="_blank" rel="noopener noreferrer" className={smallButton}>
        {ACTION_LABELS.view}
      </a>
    ) : null;
  }
  if (action === "copy_link") {
    return (
      <button type="button" className={smallButton} onClick={() => onAct(action, row)} aria-label={`Copiar el link de ${row.para.name}`} title="Copiar link">
        <Link2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }
  return (
    <button type="button" className={primary ? cn(smallButton, "border-transparent bg-primary text-primary-foreground hover:opacity-90") : smallButton} onClick={() => onAct(action, row)} disabled={busy}>
      {busy && action === "retry" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {ACTION_LABELS[action]}
    </button>
  );
}
