"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { listContactTouches } from "@/lib/actions/contact-touches";
import { ManualChannelSelector } from "@/components/sales/manual-channel-selector";
import type { WizardMember } from "@/components/sales/wizard/types";
import { ChannelChip } from "@/components/shared/channel-chip";
import { mediumLabel, sourceLabel } from "@/lib/contacts/taxonomy";
import { attributionFromTouch, describeAttribution, latestTouch, relativeDays, type TouchRow } from "@/lib/attribution/attribution";
import {
  backToLastTouch,
  chooseTouch,
  initialAttributionState,
  initialPanel,
  loadChannelChoice,
  modeLead,
  suggestionNotice,
  type AttributionFieldState,
  type AttributionPanel,
} from "@/lib/sales/attribution-field";
import { suggestSaleTouch } from "@/lib/sales/suggest-touch";
import { channelOfTouch, NO_NAMES, touchTitle, type TouchNames } from "@/lib/attribution/touch-label";
import { cn } from "@/lib/utils";

/**
 * "Atribución": de dónde vino la venta (plano F11). Una línea con el último
 * toque del contacto y un "Editar" que abre dos caminos: elegir OTRO TOQUE del
 * historial (recomendado: reusa un dato real) o cargar a mano (taxonomía
 * cerrada). Sin toques: "Sin atribución", que no bloquea nada.
 *
 * Lo usan el paso 1 del asistente de venta y la edición de la venta. El estado
 * es el que viaja al servidor; la lógica vive en `lib/sales/attribution-field.ts`.
 *
 * Extra I: si el último toque es un mensaje sin origen y hay uno anterior que sí lo tiene, el asistente arranca
 * con ese (F46, `autoSuggest`); en la edición solo se ofrece. "Cargar a mano" es el selector de canal en dos pasos
 * (F47): el servidor crea el toque al guardar.
 */
export function AttributionField({
  contactId,
  value,
  onChange,
  timeZone,
  disabled,
  members,
  autoSuggest = true,
}: {
  contactId: string | null;
  value: AttributionFieldState;
  onChange: (next: AttributionFieldState) => void;
  timeZone: string;
  disabled?: boolean;
  /** Las personas del equipo (para "Referido por alguien del equipo"). */
  members: WizardMember[];
  /** El asistente arranca con la sugerencia puesta; la edicion solo la ofrece. */
  autoSuggest?: boolean;
}) {
  const [touches, setTouches] = useState<TouchRow[]>([]);
  const [names, setNames] = useState<TouchNames>(NO_NAMES);
  // Lo ultimo que se recibio por props, para usarlo dentro de la respuesta asincronica sin repetir la consulta.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorState, setErrorState] = useState<{ contactId: string | null; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<AttributionPanel>("touches");
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
      setNames(result.data.names);
      setCursor(result.data.nextCursor);
      // F46: si el ultimo toque no dice de donde vino y hay uno anterior que si, el asistente arranca con ese.
      if (autoSuggest && valueRef.current.mode === "last_touch") {
        const initial = initialAttributionState(result.data.touches);
        if (initial.state.mode === "touch") onChangeRef.current(initial.state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [contactId, loadedFor, autoSuggest]);

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
    setNames((prev) => ({ pieces: { ...prev.pieces, ...result.data.names.pieces }, ads: { ...prev.ads, ...result.data.names.ads } }));
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
    if (value.mode === "manual_channel") return null;
    return latest ? attributionFromTouch(latest) : null;
  }, [value, touches, latest]);

  const line = value.mode === "manual_channel" ? (value.label ?? "Cargada a mano") : describeAttribution(shown, now, timeZone);
  const suggestion = useMemo(() => suggestSaleTouch(touches), [touches]);
  const notice = suggestionNotice({ state: value, suggestion, touches, timeZone, names });

  function openPanel() {
    setPanel(initialPanel(touches.length));
    setOpen(true);
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1">
          <span className="font-medium">Atribución: {modeLead(value, touches.length > 0)}</span>
          {shown || value.mode === "manual_channel" ? <> — {line}</> : <> — Sin atribución</>}
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

      {notice && (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
          <span className="min-w-0">
            {notice.before}
            <em className="font-medium not-italic">{notice.title}</em>
            {notice.after}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(notice.action.to === "last_touch" ? backToLastTouch() : chooseTouch(suggestion!.touchId))}
            className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
          >
            {notice.action.label}
          </button>
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
                        <ChannelChip channel={channelOfTouch(t)} />
                        <span className="min-w-0 flex-1 truncate font-medium" title={touchTitle(t, names)}>
                          {touchTitle(t, names)}
                        </span>
                        <span className="text-muted-foreground">{relativeDays(t.occurred_at, now, timeZone)}</span>
                        <span className="w-full text-[11px] text-muted-foreground">
                          {[sourceLabel(t.source), mediumLabel(t.medium)].filter(Boolean).join(" / ") || "Sin datos"}
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
            <ManualChannelSelector members={members} onUse={(choice, label) => onChange(loadChannelChoice(choice, label))} />
          )}
        </div>
      )}
    </div>
  );
}
