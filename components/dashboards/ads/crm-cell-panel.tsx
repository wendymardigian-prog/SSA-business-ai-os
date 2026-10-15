"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/sheet";
import { money } from "@/lib/dashboards/ads";
import type { CrmLevel } from "@/lib/dashboards/ads-crm";
import type { CellMetric } from "@/lib/dashboards/ads-crm-columns";
import { emptyMessage, hasMore, itemDetails, itemHref, itemTitle, panelHint, panelTitle, type DetailItem } from "@/lib/dashboards/ads-crm-detail";
import { loadCrmCellDetail } from "@/lib/actions/ads-crm";

/**
 * El panel que se abre al hacer clic en un número de la tabla (Tirón 2, B2): las personas o los registros que lo forman,
 * de a 50, y cada uno abre su detalle (la ficha, la agenda o la venta). Los datos se piden SOLO al abrir, nunca por adelantado.
 * Estados: cargando, vacío y error (con «Reintentar»). En el celular ocupa toda la pantalla (`Sheet`).
 */
export interface CellTarget {
  metric: CellMetric;
  /** Null = la fila de total. */
  objectId: string | null;
  objectName: string | null;
  /** El total con un filtro de estado: solo los objetos que se ven. */
  objectIds: string[] | null;
}

export function CrmCellPanel({ target, level, since, until, adAccountId, currency, timeZone, onClose }: {
  target: CellTarget;
  level: CrmLevel;
  since: string;
  until: string;
  adAccountId: string;
  currency: string | null;
  timeZone: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<DetailItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  // Pide una página. No toca el estado: quien la llama decide qué hacer con el resultado (así el efecto de abajo no cambia estado
  // de forma síncrona, y una respuesta tardía de un pedido viejo se descarta por su número).
  const fetchPage = useCallback(
    (offset: number) => loadCrmCellDetail({ level, since, until, adAccountId, objectIds: target.objectIds, metric: target.metric, objectId: target.objectId, offset }),
    [level, since, until, adAccountId, target.objectIds, target.metric, target.objectId],
  );
  const apply = useCallback((id: number, offset: number, res: Awaited<ReturnType<typeof loadCrmCellDetail>>) => {
    if (id !== requestId.current) return;
    setLoadingMore(false);
    if (!res.ok) {
      setError(res.error);
      setStatus("error");
      return;
    }
    setItems((prev) => (offset === 0 ? res.page.items : [...prev, ...res.page.items]));
    setTotal(res.page.total);
    setError(null);
    setStatus("ready");
  }, []);

  // La primera página, al abrir (el estado inicial ya es «cargando»; el panel se monta de nuevo por cada celda).
  useEffect(() => {
    const id = ++requestId.current;
    let live = true;
    void fetchPage(0).then((res) => {
      if (live) apply(id, 0, res);
    });
    return () => {
      live = false;
    };
  }, [fetchPage, apply]);

  const retry = () => {
    const id = ++requestId.current;
    setStatus("loading");
    void fetchPage(0).then((res) => apply(id, 0, res));
  };
  const loadMore = () => {
    const id = ++requestId.current;
    setLoadingMore(true);
    void fetchPage(items.length).then((res) => apply(id, items.length, res));
  };

  const formatMoney = (amount: number) => money(amount, currency, { narrow: true });
  const title = panelTitle(target.metric, target.objectName);

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">{panelHint(target.metric)}</p>
        {total !== null && status === "ready" && (
          <p className="text-xs font-medium text-foreground" aria-live="polite">
            {total.toLocaleString("es-AR")} {total === 1 ? "resultado" : "resultados"}
          </p>
        )}

        {status === "loading" && <p role="status" className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>}

        {status === "error" && (
          <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p>{error}</p>
            <button type="button" onClick={retry} className="h-8 rounded-lg border border-border px-3 text-xs hover:bg-accent">Reintentar</button>
          </div>
        )}

        {status === "ready" && items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage(target.metric)}</p>}

        {status === "ready" && items.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((item, index) => {
              const href = itemHref(target.metric, item);
              const lines = itemDetails(target.metric, item, { timeZone, formatMoney });
              const body = (
                <>
                  <p className="truncate text-sm font-medium">{itemTitle(target.metric, item)}</p>
                  {lines.length > 0 && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{lines.join(" · ")}</p>}
                </>
              );
              return (
                <li key={`${item.itemId ?? item.contactId ?? "x"}-${index}`}>
                  {href ? (
                    <Link href={href} className="block px-3 py-2 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">{body}</Link>
                  ) : (
                    <div className="px-3 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {status === "ready" && total !== null && hasMore(items.length, total) && (
          <button type="button" disabled={loadingMore} onClick={loadMore} className="h-9 w-full rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50">
            {loadingMore ? "Cargando…" : `Cargar más (${(total - items.length).toLocaleString("es-AR")} restantes)`}
          </button>
        )}
      </div>
    </Sheet>
  );
}
