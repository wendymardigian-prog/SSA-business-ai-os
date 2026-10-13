"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CloudOff, Loader2, RotateCcw } from "lucide-react";
import { submitEodReport } from "@/lib/actions/eod/submit";
import { crossedMidnight, setChannelSelected } from "@/lib/eod/draft";
import { addDays, shortDate } from "@/lib/eod/dates";
import { hasDataInUnselected, summaryLine } from "@/lib/eod/summary";
import type { FillPageData } from "@/lib/eod/load";
import { cn } from "@/lib/utils";
import { EodQuestion } from "./eod-question";
import { useEodDraft, type SaveIndicator } from "../use-eod-draft";

/**
 * La pantalla para completar un reporte de fin de día (E6). Pensada para el celular
 * primero: los números ocupan todo el ancho, los chips se tocan sin errar y la barra de
 * abajo no tapa el último campo. Solo compone: guardar es `useEodDraft`, enviar es la
 * Server Action, y todo lo que se decide vive en `lib/eod/`.
 */

function timeIn(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone });
}

function SaveStatus({ indicator, timeZone, onRetry }: { indicator: SaveIndicator; timeZone: string; onRetry: () => void }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs">
      {indicator.kind === "saved" && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> Guardado{indicator.at ? ` · ${timeIn(indicator.at, timeZone)}` : ""}
        </span>
      )}
      {indicator.kind === "saving" && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Guardando…
        </span>
      )}
      {indicator.kind === "offline" && (
        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
          <CloudOff className="h-3.5 w-3.5" aria-hidden /> Sin conexión: se guarda en este navegador y se sube cuando vuelva
        </span>
      )}
      {indicator.kind === "error" && (
        <span className="flex items-center gap-1 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> No se pudo guardar ·{" "}
          <button type="button" onClick={onRetry} className="underline">
            Reintentar
          </button>
        </span>
      )}
    </p>
  );
}

function dateLabel(date: string, today: string): string {
  if (date === today) return `Hoy (${shortDate(date)})`;
  if (date === addDays(today, -1)) return `Ayer (${shortDate(date)})`;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" });
}

export function EodFill({ page }: { page: FillPageData }) {
  const router = useRouter();
  const { form, report, reportDate, today, timeZone } = page;
  const { version, config } = form;
  const isSetter = version.channelSelector !== null;
  const submitted = report?.status === "submitted";
  const [correcting, setCorrecting] = useState(false);
  const [done, setDone] = useState<null | { edited: boolean; discarded: string[] }>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, startSubmit] = useTransition();
  const readOnly = (submitted && !correcting) || done !== null;

  const draft = useEodDraft({
    workspaceId: page.workspaceId,
    userId: page.userId,
    formId: form.id,
    reportDate,
    server: report ? { data: report.draft, rev: report.rev, savedAt: report.savedAt } : null,
    readOnly,
  });
  const { data, update } = draft;

  // Pasar la medianoche con la pestaña abierta: el reporte NO cambia de fecha; solo avisa.
  const openedAsToday = reportDate === today;
  const [midnight, setMidnight] = useState(false);
  useEffect(() => {
    if (!openedAsToday) return;
    const check = () => setMidnight(crossedMidnight(reportDate, new Date(), timeZone));
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [openedAsToday, reportDate, timeZone]);

  const active = useMemo(() => version.channels.filter((c) => c.enabled), [version.channels]);
  const summary = summaryLine({ fields: version.fields, channels: version.channels, hasChannels: isSetter, data });
  const unsentData = isSetter && hasDataInUnselected(data);
  const dates = useMemo(() => {
    const list: string[] = [];
    for (let d = page.range.max; d >= page.range.min; d = addDays(d, -1)) list.push(d);
    return list;
  }, [page.range.max, page.range.min]);

  function submit() {
    setErrors([]);
    startSubmit(async () => {
      // Lo último que se cargó tiene que estar en el servidor antes de enviar.
      const saved = await draft.flush();
      if (!saved && draft.pending()) {
        setErrors([
          typeof navigator !== "undefined" && navigator.onLine === false
            ? "Sin conexión: tu reporte está guardado en este navegador. Envialo cuando vuelva la conexión."
            : "No pudimos guardar lo último que cargaste. Probá de nuevo en unos segundos.",
        ]);
        return;
      }
      const result = await submitEodReport({ formId: form.id, reportDate, rev: draft.baseRev() });
      if (result.ok) {
        draft.clearLocal();
        setDone({ edited: result.edited, discarded: result.discarded });
        setCorrecting(false);
        router.refresh();
        return;
      }
      setErrors(result.errors && result.errors.length > 0 ? result.errors : [result.error]);
      if (result.code === "conflict") router.refresh();
    });
  }

  if (done) {
    const success = form.success.mode === "message" ? form.success : null;
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-green-700 dark:text-green-300">
          <Check className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-xl font-semibold">{done.edited ? "¡Reporte corregido!" : success?.title || "¡Reporte enviado!"}</h2>
        {success?.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{success.body}</p>}
        {done.discarded.length > 0 && (
          <p className="text-xs text-muted-foreground">Algunas preguntas ya no están en el reporte y no se guardaron: {done.discarded.join(", ")}.</p>
        )}
        {success?.button && (
          <a href={success.button.url} className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            {success.button.label}
          </a>
        )}
        <Link href="/dashboard/eod" className="mt-2 text-sm underline">
          Volver a Mi reporte del día
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-40 pt-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-5">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{config.roleLabel}</span>
              {!readOnly && <SaveStatus indicator={draft.indicator} timeZone={timeZone} onRetry={() => void draft.flush()} />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="eod-date" className="text-sm text-muted-foreground">
                Día del reporte
              </label>
              <select
                id="eod-date"
                value={reportDate}
                disabled={dates.length <= 1}
                onChange={(e) => router.push(e.target.value === today ? `/dashboard/eod/${form.id}` : `/dashboard/eod/${form.id}?fecha=${e.target.value}`)}
                className="h-10 rounded-lg border border-input bg-background px-2 text-sm capitalize"
              >
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {dateLabel(d, today)}
                  </option>
                ))}
              </select>
            </div>
          </header>

          {midnight && (
            <div role="status" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              <p>Este reporte es del {shortDate(reportDate)}. ¿Lo enviás o empezás el de hoy?</p>
              <div className="flex flex-wrap gap-2">
                {!readOnly && (
                  <button type="button" onClick={submit} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                    Enviar el del {shortDate(reportDate)}
                  </button>
                )}
                <button type="button" onClick={() => router.push(`/dashboard/eod/${form.id}`)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs">
                  Empezar el de hoy
                </button>
              </div>
            </div>
          )}

          {draft.notice && (
            <div role="status" className="flex items-start justify-between gap-2 rounded-xl border border-border bg-muted p-3 text-sm">
              <span>{draft.notice}</span>
              <button type="button" onClick={draft.dismissNotice} className="text-xs underline">
                Entendido
              </button>
            </div>
          )}

          {submitted && !correcting && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-800 dark:text-green-200">
              <Check className="h-4 w-4" aria-hidden />
              <span>
                Enviado a las {timeIn(report?.submittedAt ?? null, timeZone)}
                {report && report.editCount > 0 ? ` · corregido ${report.editCount === 1 ? "una vez" : `${report.editCount} veces`}` : ""}
              </span>
              {config.reportMode === "editable" && (
                <button type="button" onClick={() => setCorrecting(true)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Corregir
                </button>
              )}
            </div>
          )}

          {version.fields.length > 0 && (
            <section aria-label="Preguntas generales" className="space-y-5 rounded-2xl border border-border bg-card p-4">
              {version.fields.map((field) => (
                <EodQuestion key={field.id} field={field} channel={null} data={data} update={update} disabled={readOnly} />
              ))}
            </section>
          )}

          {isSetter && (
            <section aria-labelledby="eod-channels" className="space-y-3">
              <h2 id="eod-channels" className="text-sm font-medium">
                {version.channelSelector?.label}
                {version.channelSelector?.required && (
                  <span className="text-destructive" aria-hidden>
                    {" "}
                    *
                  </span>
                )}
              </h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label={version.channelSelector?.label}>
                {active.map((channel) => {
                  const on = data.channels[channel.key]?.selected === true;
                  return (
                    <button
                      key={channel.key}
                      type="button"
                      aria-pressed={on}
                      disabled={readOnly}
                      onClick={() => update((d) => setChannelSelected(d, channel.key, !(d.channels[channel.key]?.selected === true)))}
                      className={cn(
                        "min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
                      )}
                    >
                      {channel.label}
                    </button>
                  );
                })}
              </div>
              {active
                .filter((c) => data.channels[c.key]?.selected)
                .map((channel) => (
                  <section key={channel.key} aria-label={channel.label} className="space-y-5 rounded-2xl border border-border bg-card p-4">
                    <h3 className="text-base font-semibold">{channel.label}</h3>
                    {channel.fields.map((field) => (
                      <EodQuestion key={field.id} field={field} channel={channel.key} channelLabel={channel.label} data={data} update={update} disabled={readOnly} />
                    ))}
                  </section>
                ))}
            </section>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-2xl space-y-2">
            {errors.length > 0 && (
              <div role="alert" className="max-h-40 overflow-auto rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <ul className="list-inside list-disc space-y-0.5">
                  {errors.slice(0, 10).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium tabular-nums">{summary || "Tu reporte del día"}</p>
                {unsentData && <p className="text-[11px] text-muted-foreground">Solo se envía lo de los canales prendidos.</p>}
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {submitted ? "Reenviar reporte" : "Enviar reporte"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
