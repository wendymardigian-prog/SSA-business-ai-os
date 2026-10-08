"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Library, Loader2, Send, X } from "lucide-react";
import {
  acceptanceFor,
  disabledKindsFor,
  pickOutcome,
  widgetResults,
  type WidgetAction,
  type WidgetState,
} from "@/lib/inbox/asset-widget";
import { contextLine, hasActiveFilters, kindCounts, NO_FILTERS, tagCounts, type BankAsset } from "@/lib/response-assets/list";
import { acceptsCaption } from "@/lib/response-assets/kind";
import type { TemplateContext } from "@/lib/templates/interpolate";
import { AssetFilterBar } from "@/components/response-assets/asset-filter-bar";
import { AssetThumb } from "@/components/response-assets/asset-thumb";
import { AssetPreview } from "@/components/response-assets/asset-preview";
import { cn } from "@/lib/utils";

const MANAGE_HREF = "/dashboard/settings/recursos";

/**
 * El widget de recursos guardados de la bandeja (banca v2, F7-F9).
 *
 * UN solo componente para las tres formas de abrirlo ("/", el boton de la
 * biblioteca y ⌘/Ctrl + /): si fueran dos, uno se quedaria atras. No decide
 * nada: el estado, el teclado y que pasa al elegir viven en
 * lib/inbox/asset-widget.ts; filtrar y contar, en lib/response-assets/list.ts.
 *
 * Se abre siempre, con la banca vacia tambien (antes no se abria y por eso
 * nadie sabia que existia). Enter nunca manda: un texto o un enlace se
 * insertan en el composer; lo que tiene archivo abre el preview, y mandar es
 * un clic en Enviar.
 */
export function AssetPicker({
  state,
  dispatch,
  assets,
  provider,
  context,
  canManage,
  sending,
  shortcutLabel,
  onInsert,
  onSend,
  onClose,
}: {
  state: WidgetState;
  dispatch: Dispatch<WidgetAction>;
  assets: BankAsset[];
  /** El proveedor del canal: decide que tipos se pueden mandar aca. */
  provider: string | null;
  /** Para interpolar las variables de un texto con el contacto y el negocio reales. */
  context: TemplateContext;
  /** Puede crear recursos: el estado vacio le ofrece crear el primero. */
  canManage: boolean;
  sending: boolean;
  shortcutLabel: string;
  onInsert: (text: string, asset: BankAsset) => void;
  onSend: (asset: BankAsset, caption: string) => void;
  /** `restore`: se cerro con Escape desde la lista (devolver la barra al composer). */
  onClose: (restore: boolean) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  const results = useMemo(() => widgetResults(assets, state.filters), [assets, state.filters]);
  const activeAssets = useMemo(() => assets.filter((a) => a.isActive), [assets]);
  const counts = useMemo(() => kindCounts(activeAssets, state.filters), [activeAssets, state.filters]);
  const tags = useMemo(() => tagCounts(activeAssets, state.filters), [activeAssets, state.filters]);
  const disabledKinds = useMemo(() => disabledKindsFor(provider), [provider]);
  const previewAsset = state.previewId ? (assets.find((a) => a.id === state.previewId) ?? null) : null;

  // El foco va al buscador al abrir y al volver del preview.
  useEffect(() => {
    if (state.view === "list") searchRef.current?.focus();
  }, [state.view]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.activeIndex]);

  // Un clic afuera lo cierra (salvo en el boton que lo abre: ese lo alterna).
  useEffect(() => {
    if (state.view === "closed") return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || containerRef.current?.contains(target)) return;
      if (target.closest("[data-asset-widget-toggle]")) return;
      onClose(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [state.view, onClose]);

  if (state.view === "closed") return null;

  function choose(asset: BankAsset) {
    const outcome = pickOutcome(asset, provider, context);
    if (outcome.type === "blocked") {
      setBlockedNotice(outcome.reason);
      return;
    }
    setBlockedNotice(null);
    if (outcome.type === "insert") onInsert(outcome.text, asset);
    else dispatch({ type: "preview", assetId: asset.id });
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      dispatch({ type: "move", delta: event.key === "ArrowDown" ? 1 : -1, count: results.length });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = results[state.activeIndex];
      if (chosen) choose(chosen);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Recursos guardados"
      onKeyDown={(event) => {
        // Escape desde cualquier lugar del widget (un chip, el preview): en el
        // preview vuelve a la lista; en la lista, cierra.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        if (state.view === "preview") dispatch({ type: "back" });
        else onClose(true);
      }}
      className="absolute bottom-full left-0 right-0 z-30 mb-2 flex max-h-[min(30rem,70vh)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {state.view === "preview" ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "back" })}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Volver a la lista
          </button>
        ) : (
          <>
            <Library className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Recursos guardados</span>
            <kbd className="hidden rounded border border-border px-1 text-[10px] text-muted-foreground sm:inline">{shortcutLabel}</kbd>
          </>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onClose(false)}
          aria-label="Cerrar recursos guardados"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {state.view === "preview" && previewAsset ? (
        <PreviewPane
          key={previewAsset.id}
          asset={previewAsset}
          provider={provider}
          sending={sending}
          onSend={onSend}
          onCancel={() => onClose(false)}
        />
      ) : (
        <>
          <div className="border-b border-border px-3 py-2">
            <AssetFilterBar
              ref={searchRef}
              compact
              filters={state.filters}
              onChange={(filters) => {
                setBlockedNotice(null);
                dispatch({ type: "filters", filters });
              }}
              counts={counts}
              tags={tags}
              disabledKinds={disabledKinds}
              onSearchKeyDown={onSearchKeyDown}
              placeholder="Buscar un recurso…"
              searchLabel="Buscar un recurso guardado"
            />
          </div>

          {blockedNotice && (
            <p role="status" className="border-b border-border bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
              {blockedNotice}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {activeAssets.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <p className="text-sm font-medium">Todavía no hay recursos</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Guardá los textos, audios, videos, imágenes, archivos y enlaces que más mandás y los vas a tener acá a un clic.
                </p>
                {canManage ? (
                  <Link href={MANAGE_HREF} className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                    Crear el primero
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">Pedile a alguien con permiso que cargue el primero.</p>
                )}
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {state.filters.query.trim()
                    ? `No hay recursos que coincidan con «${state.filters.query.trim()}».`
                    : "No hay recursos con estos filtros."}
                </p>
                {hasActiveFilters(state.filters) && (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "filters", filters: NO_FILTERS })}
                    className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-muted"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            ) : (
              <ul role="listbox" aria-label="Resultados" className="py-1">
                {results.map((asset, index) => {
                  const acceptance = acceptanceFor(asset, provider);
                  const active = index === state.activeIndex;
                  return (
                    <li
                      key={asset.id}
                      ref={active ? activeRef : undefined}
                      role="option"
                      aria-selected={active}
                      aria-disabled={!acceptance.ok || undefined}
                      title={acceptance.ok ? undefined : acceptance.reason}
                      // onMouseDown y no onClick: el foco no se va del buscador
                      // antes de elegir.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(asset);
                      }}
                      onMouseEnter={() => dispatch({ type: "hover", index })}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 px-3 py-2",
                        active && "bg-accent",
                        !acceptance.ok && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <AssetThumb asset={asset} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{asset.name}</span>
                          {asset.shortcut && <code className="flex-shrink-0 rounded bg-muted px-1 text-[11px]">{asset.shortcut}</code>}
                          {asset.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="hidden flex-shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted-foreground sm:inline">
                              #{tag}
                            </span>
                          ))}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {acceptance.ok ? contextLine(asset, 110) : acceptance.reason}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            ↑↓ para elegir · Enter inserta un texto o abre el resto para revisarlo · Esc para cerrar
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Revisar antes de mandar (F9): el reproductor, la imagen o el "Abrir", la
 * transcripcion entera y el texto que lo acompaña, editable. Mandar es un
 * clic explicito en Enviar.
 */
function PreviewPane({
  asset,
  provider,
  sending,
  onSend,
  onCancel,
}: {
  asset: BankAsset;
  provider: string | null;
  sending: boolean;
  onSend: (asset: BankAsset, caption: string) => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState(asset.caption ?? "");
  const acceptance = acceptanceFor(asset, provider);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <p className="mb-2 text-sm font-medium">{asset.name}</p>
        <AssetPreview asset={asset}>
          {acceptsCaption(asset.kind) && (
            <div>
              <label htmlFor="asset-caption-send" className="mb-1 block text-xs font-medium text-muted-foreground">
                Texto que lo acompaña (opcional)
              </label>
              <textarea
                id="asset-caption-send"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={2}
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
          {!acceptance.ok && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">{acceptance.reason}</p>
          )}
        </AssetPreview>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          Cerrar sin mandar
        </button>
        <button
          type="button"
          onClick={() => onSend(asset, caption)}
          disabled={sending || !acceptance.ok}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          Enviar
        </button>
      </div>
    </div>
  );
}
