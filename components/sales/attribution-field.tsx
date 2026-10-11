"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { listContactTouches } from "@/lib/actions/contact-touches";
import { MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS, mediumLabel, sourceLabel } from "@/lib/contacts/taxonomy";
import { attributionFromTouch, describeAttribution, latestTouch, relativeDays, type TouchRow } from "@/lib/sales/attribution";
import {
  backToLastTouch,
  chooseTouch,
  EMPTY_MANUAL,
  initialPanel,
  loadManually,
  modeLead,
  type AttributionFieldState,
  type AttributionPanel,
} from "@/lib/sales/attribution-field";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";

/**
 * "Atribución": de dónde vino la venta (plano F11). Una línea con el último
 * toque del contacto y un "Editar" que abre dos caminos: elegir OTRO TOQUE del
 * historial (recomendado: reusa un dato real) o cargar a mano (taxonomía
 * cerrada). Sin toques: "Sin atribución", que no bloquea nada.
 *
 * Lo usan el paso 1 del asistente de venta y la edición de la venta. El estado
 * es el que viaja al servidor; la lógica vive en `lib/sales/attribution-field.ts`.
 */
export function AttributionField({
  contactId,
  value,
  onChange,
  timeZone,
  disabled,
}: {
  contactId: string | null;
  value: AttributionFieldState;
  onChange: (next: AttributionFieldState) => void;
  timeZone: string;
  disabled?: boolean;
}) {
  const [touches, setTouches] = useState<TouchRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorState, setErrorState] = useState<{ contactId: string | null; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<AttributionPanel>("touches");
  const [manual, setManual] = useState({ ...EMPTY_MANUAL });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Los toques de ESTE contacto: se cargan al elegirlo (la primera página alcanza para la línea).
  // `loading` y `error` se derivan de lo que ya llegó: nada se setea de forma síncrona acá.
  useEffect(() => {
    if (!contactId || contactId === loadedFor) return;
    let cancelled = false;
    listContactTouches({ contactId }).then((result) => {
      if (cancelled) return;
      setLoadedFor(contactId);
      if (!result.ok) {
        setErrorState({ contactId, message: result.error });
        setTouches([]);
        setCursor(null);
        return;
      }
      setErrorState(null);
      setTouches(result.data.touches);
      setCursor(result.data.nextCursor);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId, loadedFor]);

  const loading = loadingMore || (contactId !== null && loadedFor !== contactId);
  const error = errorState && errorState.contactId === contactId ? errorState.message : null;

  async function loadMore() {
    if (!contactId || !cursor) return;
    setLoadingMore(true);
    const result = await listContactTouches({ contactId, cursor });
    setLoadingMore(false);
    if (!result.ok) {
      setErrorState({ contactId, message: result.error });
      return;
    }
    setTouches((prev) => [...prev, ...result.data.touches]);
    setCursor(result.data.nextCursor);
  }

  const now = useMemo(() => new Date(), []);
  const latest = latestTouch(touches);
  const shown = useMemo(() => {
    if (value.mode === "touch") {
      const picked = touches.find((t) => t.id === value.touchId);
      return picked ? attributionFromTouch(picked) : null;
    }
    if (value.mode === "manual") {
      const m = (value.manual ?? {}) as { source?: string; medium?: string; campaign?: string };
      return { source: m.source || undefined, medium: m.medium || undefined, campaign: m.campaign || undefined };
    }
    return latest ? attributionFromTouch(latest) : null;
  }, [value, touches, latest]);

  const line = describeAttribution(shown, now, timeZone);

  function openPanel() {
    setPanel(initialPanel(touches.length));
    setOpen(true);
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1">
          <span className="font-medium">Atribución: {modeLead(value, touches.length > 0)}</span>
          {shown ? <> — {line}</> : <> — Sin atribución</>}
          {loading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        </p>
        <button
          type="button"
          disabled={disabled || !contactId}
          onClick={() => (open ? setOpen(false) : openPanel())}
          className="h-8 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {open ? "Cerrar" : "Editar"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {open && (
        <div className="space-y-3 border-t border-border pt-3">
          {value.mode !== "last_touch" && (
            <button type="button" onClick={() => onChange(backToLastTouch())} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
              Volver al último toque
            </button>
          )}

          <div role="tablist" aria-label="Cómo atribuir" className="flex gap-1">
            {touches.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={panel === "touches"}
                onClick={() => setPanel("touches")}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", panel === "touches" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent")}
              >
                Elegir otro toque (recomendado)
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={panel === "manual"}
              onClick={() => setPanel("manual")}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", panel === "manual" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent")}
            >
              Cargar a mano
            </button>
          </div>

          {panel === "touches" && touches.length > 0 && (
            <div>
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {touches.map((t) => {
                  const selected = value.mode === "touch" && value.touchId === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onChange(chooseTouch(t.id))}
                        aria-pressed={selected}
                        className={cn("flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-xs hover:bg-accent/50", selected && "bg-primary/10")}
                      >
                        <span className="font-medium">{relativeDays(t.occurred_at, now, timeZone)}</span>
                        <span className="text-muted-foreground">
                          {[sourceLabel(t.source), mediumLabel(t.medium), t.campaign ? `campaña ${t.campaign}` : ""].filter(Boolean).join(" / ") || "Sin datos"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {cursor && (
                <button type="button" onClick={loadMore} disabled={loading} className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50">
                  Ver más
                </button>
              )}
            </div>
          )}

          {panel === "manual" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium">Fuente</span>
                <select value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })} className={fieldInput}>
                  <option value="">Elegí…</option>
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Medio</span>
                <select value={manual.medium} onChange={(e) => setManual({ ...manual, medium: e.target.value })} className={fieldInput}>
                  <option value="">Sin medio</option>
                  {MEDIUMS.map((m) => (
                    <option key={m} value={m}>
                      {MEDIUM_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              {(["campaign", "content", "term"] as const).map((key) => (
                <label key={key} className="block space-y-1">
                  <span className="text-xs font-medium">{key === "campaign" ? "Campaña" : key === "content" ? "Contenido" : "Término"}</span>
                  <input value={manual[key]} maxLength={200} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} className={fieldInput} />
                </label>
              ))}
              <div className="sm:col-span-2">
                <button
                  type="button"
                  disabled={!manual.source}
                  onClick={() => onChange(loadManually({ source: manual.source as never, medium: (manual.medium || undefined) as never, campaign: manual.campaign, content: manual.content, term: manual.term }))}
                  className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Usar esta atribución
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
