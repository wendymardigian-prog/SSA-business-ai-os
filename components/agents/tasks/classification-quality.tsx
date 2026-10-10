"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/tooltip";
import { Sparkline } from "@/components/dashboards/chat/sparkline";
import { addButtonTextAction, confirmTextAction, moveTextAction, removeButtonTextAction } from "@/lib/actions/patterns";
import type { BackgroundScreenData } from "@/lib/background/screen-data";

/**
 * La calidad del clasificador de mensajes (F19, F25): los cuatro indicadores,
 * la revision rapida y los textos de boton conocidos.
 *
 * Antes vivian en Ajustes - Tareas (components/settings/background-tasks-view.tsx,
 * borrado). Ahora son parte de la pestana Configuracion de la tarea
 * "Clasificacion de mensajes" en Agentes IA (unica tarea que los usa: las
 * demas no clasifican texto libre).
 */

const ACCURACY_REFERENCE = 90;

export function QualityPanel({
  data,
  categories,
}: {
  data: BackgroundScreenData;
  categories: Array<{ id: string; name: string; direction: string }>;
}) {
  const q = data.quality;
  const accuracyPct = q.estimatedAccuracy === null ? null : Math.round(q.estimatedAccuracy * 100);

  return (
    <section className="rounded-[14px] border border-border bg-card">
      <header className="px-[18px] pb-1.5 pt-4">
        <h2 className="text-[15px] font-semibold">Calidad de la clasificación de mensajes</h2>
        <p className="text-xs text-muted-foreground">Sobre todos los textos clasificados</p>
      </header>

      <div className="mt-1 grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-4">
        <Indicator
          label="Precisión estimada"
          tooltip="Porcentaje de aciertos en las revisiones rápidas. Es la medida más confiable: sale de lo que una persona confirmó."
          value={accuracyPct === null ? "sin revisiones" : `${accuracyPct} %`}
          hint={q.reviewedCount > 0 ? `sobre ${q.reviewedCount} textos revisados` : "revisá algunos para tener una medida"}
        />
        <Indicator label="Corregidos" value={`${q.corrected}`} hint="textos que alguien movió de categoría" />
        <Indicator
          label="Sin categoría"
          tooltip="Parte del VOLUMEN de mensajes que quedó en “Otro” o sin clasificar. Se mide sobre mensajes y no sobre textos distintos: dos textos raros no son lo mismo que doscientos mensajes."
          value={`${q.uncategorizedMessagePct} %`}
          hint="del volumen de mensajes"
        />
        <Indicator label="Dudosos" value={`${q.lowConfidence}`} hint="confianza menor a 70 %" tone={q.lowConfidence > 0 ? "warn" : undefined} />
      </div>

      <div className="grid gap-6 px-[18px] py-4 md:grid-cols-3">
        <div>
          <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">Precisión por semana</p>
          <Sparkline
            values={data.accuracyWeeks.map((w) => w.accuracy)}
            goal={ACCURACY_REFERENCE}
            label="Precisión por semana, últimas 7 semanas"
          />
          <p className="mt-1 text-[11.5px] text-muted-foreground">Línea punteada: {ACCURACY_REFERENCE} %. Una semana sin revisiones queda vacía.</p>
        </div>

        <div>
          <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">Categorías con más correcciones</p>
          {data.mostCorrected.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Todavía nadie corrigió ninguna.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.mostCorrected.map((c) => (
                <li key={c.categoryId}>
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate">{c.name}</span>
                    <b className="shrink-0 font-semibold tabular-nums">{c.pct} %</b>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-[4px] bg-muted">
                    <div className="h-full rounded-[4px] bg-warn" style={{ width: `${c.pct}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">
                    {c.corrected} de {c.total} textos
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
            ¿La confianza es creíble?
            <InfoTooltip
              text="Compara la confianza que dio el modelo con los aciertos reales en las revisiones. Si en el tramo alto acierta poco, la confianza no sirve para decidir nada."
              label="Qué es la calibración"
            />
          </p>
          <dl className="grid grid-cols-[auto_auto] gap-x-3.5 gap-y-1.5 text-[13px] text-muted-foreground">
            <Calibration label="Confianza > 90 %" bucket={q.calibration.high} />
            <Calibration label="70–90 %" bucket={q.calibration.mid} />
            <Calibration label="< 70 %" bucket={q.calibration.low} warn />
          </dl>
        </div>
      </div>

      <ReviewCard data={data} categories={categories} />
    </section>
  );
}

function Calibration({ label, bucket, warn }: { label: string; bucket: { n: number; accuracy: number | null }; warn?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={cn("font-semibold tabular-nums", warn && bucket.accuracy !== null && bucket.accuracy < 0.7 ? "text-warn" : "text-foreground")}>
        {bucket.accuracy === null ? "sin revisiones" : `${Math.round(bucket.accuracy * 100)} % aciertos`}
        {bucket.n > 0 && <span className="ml-1 font-normal text-muted-foreground">({bucket.n})</span>}
      </dd>
    </>
  );
}

function Indicator({
  label,
  value,
  hint,
  tooltip,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tooltip?: string;
  tone?: "warn";
}) {
  return (
    <div className="bg-card px-[18px] py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {tooltip && <InfoTooltip text={tooltip} label={`Qué significa ${label}`} />}
      </p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "warn" && "text-warn")}>{value}</p>
      <p className="text-[11.5px] text-muted-foreground/80">{hint}</p>
    </div>
  );
}

/**
 * La revisión rápida: de a uno, primero los dudosos y las categorías nuevas.
 *
 * Confirmar NO cambia `source`: el texto lo sigue habiendo clasificado el modelo
 * y por eso cuenta como acierto. Corregir sí lo pasa a humano y nunca se pisa.
 */
function ReviewCard({
  data,
  categories,
}: {
  data: BackgroundScreenData;
  categories: Array<{ id: string; name: string; direction: string }>;
}) {
  const [index, setIndex] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const queue = data.reviewCandidates;
  const current = queue[index];

  function next() {
    setIndex((i) => i + 1);
  }

  if (queue.length === 0) {
    return (
      <div className="border-t border-border px-[18px] py-4">
        <p className="text-[13px] font-medium">No hay nada para revisar</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cuando el clasificador corra y deje textos dudosos o categorías nuevas, aparecen acá de a uno.
        </p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="border-t border-border px-[18px] py-4 text-center">
        <p className="text-[13px] font-semibold">Revisión terminada</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Tus respuestas se suman al set de control.</p>
        <button
          type="button"
          onClick={() => setIndex(0)}
          className="mt-2.5 rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          Empezar otra
        </button>
      </div>
    );
  }

  const options = categories.filter((c) => c.direction === current.direction && c.id !== current.categoryId);

  return (
    <div className="border-t border-border px-[18px] py-4">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
        <p className="font-semibold">
          Revisión rápida · {index + 1} de {queue.length}
        </p>
        <p className="text-xs text-muted-foreground">Primero las de menor confianza y las categorías nuevas</p>
      </div>

      <div className="max-w-[620px] rounded-xl border border-border bg-muted/40 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {current.direction === "inbound" ? "Mensaje recibido" : "Mensaje enviado"}
        </p>
        <p className="my-1.5 text-[17px]">“{current.text}”</p>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          Clasificado como <b className="font-semibold text-foreground">{current.categoryName ?? "sin categoría"}</b>
          {current.confidence !== null && (
            <span className={cn("rounded-[5px] bg-muted px-1.5 text-[11.5px] font-semibold tabular-nums", current.confidence < 0.7 && "bg-warn/15 text-warn")}>
              {Math.round(current.confidence * 100)} %
            </span>
          )}
          {current.categoryIsNew && <span className="rounded-[5px] border border-border px-1.5 text-[11.5px]">categoría nueva</span>}
        </p>

        {error && <p className="mt-2 text-xs text-bad">{error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await confirmTextAction(current.textId);
                if (!result.ok) {
                  setError(result.error ?? "No se pudo guardar");
                  return;
                }
                next();
              })
            }
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            Está bien
          </button>

          <label>
            <span className="sr-only">Cambiar la categoría de este texto</span>
            <select
              value=""
              disabled={pending}
              onChange={(e) => {
                const categoryId = e.target.value;
                if (!categoryId) return;
                start(async () => {
                  setError(null);
                  const result = await moveTextAction(current.textId, categoryId);
                  if (!result.ok) {
                    setError(result.error ?? "No se pudo mover");
                    return;
                  }
                  next();
                });
              }}
              className="h-8 max-w-[220px] rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">Cambiar a…</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={pending}
            onClick={next}
            className="h-8 rounded-lg border border-input px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            Saltar
          </button>
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
        </div>
      </div>
    </div>
  );
}


/**
 * Los textos de botón conocidos (F19).
 *
 * Un texto marcado como botón lleva `source = 'rule'`: **el modelo no lo vuelve a
 * mirar**. Que un clic en un botón es un clic en un botón no es una
 * interpretación, y pagarle a un modelo para que lo decida es tirar plata.
 */
export function ButtonTextsPanel({ buttonTexts }: { buttonTexts: BackgroundScreenData["buttonTexts"] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="rounded-[14px] border border-border bg-card">
      <header className="px-[18px] pb-1.5 pt-4">
        <h2 className="text-[15px] font-semibold">Textos de botón conocidos</h2>
        <p className="text-xs text-muted-foreground">
          Lo que el lead escribe al tocar un botón de una automatización. El clasificador no los toca y el agente los
          reconoce como un clic, no como algo que alguien escribió.
        </p>
      </header>

      <form
        className="flex flex-wrap items-center gap-2 px-[18px] pb-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value) return;
          start(async () => {
            setError(null);
            const result = await addButtonTextAction(value);
            if (!result.ok) {
              setError(result.error ?? "No se pudo agregar");
              return;
            }
            setText("");
          });
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Texto de botón nuevo</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Si enviámelo"
            className="h-9 w-full max-w-[380px] rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending || text.trim().length === 0}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
          Agregar
        </button>
      </form>
      {error && <p className="px-[18px] pb-2 text-xs text-bad">{error}</p>}

      {buttonTexts.length === 0 ? (
        <p className="px-[18px] pb-4 text-[13px] text-muted-foreground">Todavía no hay ninguno.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {buttonTexts.map((b) => (
            <ButtonTextRow key={b.textId} text={b} />
          ))}
        </ul>
      )}

      <footer className="border-t border-border px-[18px] py-2.5 text-xs text-muted-foreground">
        Sacar uno de la lista lo devuelve al clasificador, que le va a buscar una categoría.
      </footer>
    </section>
  );
}

function ButtonTextRow({ text }: { text: BackgroundScreenData["buttonTexts"][number] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex items-center gap-3 px-[18px] py-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate">{text.text}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{text.messageCount} mensajes</span>
      {error && <span className="shrink-0 text-xs text-bad">{error}</span>}
      <button
        type="button"
        aria-label={`Quitar “${text.text}” de los textos de botón`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await removeButtonTextAction(text.textId);
            if (!result.ok) setError(result.error ?? "No se pudo quitar");
          })
        }
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </li>
  );
}
