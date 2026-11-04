"use client";

import { EmailDeliveryNotice } from "@/components/email/email-delivery-notice";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Mail, MessageCircle, Plus, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactFiltersPanel } from "@/components/contacts/filters-panel";
import { ActiveFilterChips } from "@/components/contacts/active-filter-chips";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { VariableChips } from "@/components/flow-builder/panels/variable-chips";
import { CONTACT_FILTERS } from "@/lib/contacts/list-modules";
import { CUSTOM_FILTER_PARAMS, countMenuFilters, customFilterRawValue, parseContactListFilters } from "@/lib/contacts/list-query";
import type { CustomFieldRef } from "@/lib/contacts/list-filters";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import { firstParam } from "@/lib/url-params";
import { datetimeInputToIso, isoToDatetimeInput } from "@/lib/dates";
import { broadcastVariableList, MAX_VARIANTS, templateVariables } from "@/lib/broadcasts/render";
import { draftProblems } from "@/lib/broadcasts/draft";
import { combinePolicies, describePolicy, estimateFinish, paceExceedsCeiling, parseBroadcastPace, type SendPolicy } from "@/lib/send-queue/pace";
import type { BroadcastChannelKind } from "@/lib/broadcasts/audience";
import { formatEta } from "@/lib/broadcasts/status";
import {
  deleteBroadcastDraftAction,
  previewBroadcastAudience,
  previewBroadcastMessage,
  queueBroadcastAction,
  saveBroadcast,
} from "@/lib/actions/broadcasts";
import type { AudiencePreview, MessagePreview } from "@/lib/broadcasts/preview-types";

/**
 * El borrador de un broadcast, en cuatro pasos: a quiénes (los MISMOS filtros
 * de Contactos), por qué canal (con cuántos se alcanzan), qué mensaje
 * (variables, respaldos y variantes) y cuándo (ahora o programado, con el
 * ritmo). Se guarda solo; "Poner en cola" congela la audiencia en el servidor.
 */

type Params = Record<string, string | string[]>;

export interface EditorChannel {
  id: string;
  kind: BroadcastChannelKind;
  label: string;
  policy: SendPolicy;
  connectionStatus: string | null;
}

export interface EditorDraft {
  id: string;
  name: string;
  channelId: string | null;
  audienceParams: Params;
  includePhoneOnly: boolean;
  variants: string[];
  emailSubject: string;
  skipMissingVariables: boolean;
  pace: { minGapSeconds?: number; maxGapSeconds?: number; perHour?: number | null; perDay?: number | null };
  scheduledFor: string | null;
}

const input =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring";

export function BroadcastEditor({
  draft,
  channels,
  filterOptions,
  customFields,
  hasAnonymous,
  timeZone,
}: {
  draft: EditorDraft;
  channels: EditorChannel[];
  filterOptions: Record<string, MultiFilterOption[]>;
  customFields: CustomFieldRef[];
  hasAnonymous: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(draft.name);
  const [channelId, setChannelId] = useState<string | null>(draft.channelId);
  const [params, setParams] = useState<Params>(draft.audienceParams);
  const [includePhoneOnly, setIncludePhoneOnly] = useState(draft.includePhoneOnly);
  const [variants, setVariants] = useState<string[]>(draft.variants.length > 0 ? draft.variants : [""]);
  const [emailSubject, setEmailSubject] = useState(draft.emailSubject);
  const [skipMissing, setSkipMissing] = useState(draft.skipMissingVariables);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">(draft.scheduledFor ? "later" : "now");
  const [scheduledLocal, setScheduledLocal] = useState(isoToDatetimeInput(draft.scheduledFor, timeZone));
  const [pace, setPace] = useState(draft.pace);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reachResult, setReachResult] = useState<{ key: string; preview: AudiencePreview | null; error: string | null } | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [messagePreview, setMessagePreview] = useState<MessagePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queuing, startQueue] = useTransition();
  const [deleting, startDelete] = useTransition();
  // "Ahora" para la fecha estimada y para avisar una fecha programada que ya pasó. Se mide en un efecto (no en el render) y se renueva cada minuto.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  const channel = channels.find((c) => c.id === channelId) ?? null;
  const kind = channel?.kind ?? null;
  const search = firstParam(params.q);
  const filters = useMemo(() => parseContactListFilters(params, customFields, search), [params, customFields, search]);
  const variableList = useMemo(() => broadcastVariableList(customFields), [customFields]);
  const scheduledIso = scheduleMode === "later" ? datetimeInputToIso(scheduledLocal, timeZone) : null;

  // ── Guardado automático ───────────────────────────────────────────────
  const patch = useMemo(
    () => ({
      name,
      channelId,
      audienceParams: params,
      includePhoneOnly,
      variants,
      emailSubject: emailSubject || null,
      skipMissingVariables: skipMissing,
      pace,
      scheduledFor: scheduledIso,
    }),
    [name, channelId, params, includePhoneOnly, variants, emailSubject, skipMissing, pace, scheduledIso],
  );
  const firstRender = useRef(true);
  const latestPatch = useRef(patch);
  useEffect(() => {
    latestPatch.current = patch;
  }, [patch]);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setSaveState("saving");
      const res = await saveBroadcast(draft.id, latestPatch.current);
      setSaveState(res.ok ? "saved" : "error");
      setSaveError(res.ok ? null : res.error);
    }, 700);
    return () => clearTimeout(t);
  }, [patch, draft.id]);

  // ── A cuántos les llega ───────────────────────────────────────────────
  // El conteo vale para los filtros, el canal y la casilla con los que se pidió: si cambió algo, está "contando".
  const reachKey = JSON.stringify([params, channelId, includePhoneOnly]);
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await previewBroadcastAudience({ audienceParams: params, channelId, includePhoneOnly });
      if (cancelled) return;
      setReachResult(res.ok ? { key: reachKey, preview: res.preview, error: null } : { key: reachKey, preview: null, error: res.error });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [params, channelId, includePhoneOnly, reachKey]);
  const reachFresh = reachResult?.key === reachKey;
  // Mientras cuenta de nuevo se sigue mostrando el número anterior (atenuado).
  const reach = reachResult?.preview ?? null;
  const reachState: "idle" | "loading" | "error" = !reachFresh ? "loading" : reachResult?.error ? "error" : "idle";
  const reachError = reachResult?.error ?? null;

  // ── Filtros (estado local, mismas reglas que Contactos) ───────────────
  function setList(param: string, values: readonly string[]) {
    setParams((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[param];
      else next[param] = values.length === 1 ? values[0] : [...values];
      return next;
    });
  }
  function setMany(patch: Record<string, string>) {
    setParams((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v) next[k] = v;
        else delete next[k];
      }
      return next;
    });
  }
  function clearFilters() {
    setParams((prev): Params => (prev.q ? { q: prev.q } : {}));
  }

  // ── Mensaje ───────────────────────────────────────────────────────────
  const textareas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focused, setFocused] = useState(0);
  function insertVariable(token: string) {
    const i = Math.min(focused, variants.length - 1);
    const el = textareas.current[i];
    const current = variants[i] ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const nextText = current.slice(0, start) + token + current.slice(end);
    setVariants((prev) => prev.map((v, idx) => (idx === i ? nextText : v)));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  const noFallback = [
    ...new Set([...variants, kind === "email" ? emailSubject : ""].flatMap((t) => templateVariables(t).filter((v) => !v.hasFallback).map((v) => v.path))),
  ];

  function runMessagePreview() {
    setPreviewError(null);
    startPreview(async () => {
      const res = await previewBroadcastMessage({ broadcastId: draft.id, audienceParams: params, channelId, includePhoneOnly, variants, emailSubject });
      if (res.ok) setMessagePreview(res.preview);
      else {
        setMessagePreview(null);
        setPreviewError(res.error);
      }
    });
  }

  // ── Envío ─────────────────────────────────────────────────────────────
  const ownPace = parseBroadcastPace(pace);
  const effectivePolicy = channel ? combinePolicies(channel.policy, ownPace) : null;
  const sendable = reach?.reach.sendable ?? 0;
  const etaFrom = scheduledIso ? new Date(scheduledIso) : nowMs !== null ? new Date(nowMs) : null;
  const eta = effectivePolicy && sendable > 0 && etaFrom ? estimateFinish(sendable, effectivePolicy, etaFrom, timeZone) : null;
  const problems = [
    ...draftProblems({ channel_id: channelId, message_variants: variants, email_subject: emailSubject }, kind, customFields),
    ...(scheduleMode === "later" && !scheduledIso ? ["Elegí el día y la hora del envío."] : []),
    ...(scheduleMode === "later" && scheduledIso && nowMs !== null && new Date(scheduledIso).getTime() < nowMs ? ["La fecha programada ya pasó."] : []),
    ...(reach && sendable === 0 ? ["Con estos filtros y este canal no queda nadie a quien mandarle."] : []),
  ];
  const ready = problems.length === 0 && reach !== null && reachState === "idle";

  function queue() {
    setQueueError(null);
    startQueue(async () => {
      const saved = await saveBroadcast(draft.id, latestPatch.current);
      if (!saved.ok) {
        setQueueError(saved.error);
        return;
      }
      const res = await queueBroadcastAction(draft.id);
      if (!res.ok) {
        setQueueError(res.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("¿Borrar este borrador? No se mandó nada todavía.")) return;
    startDelete(async () => {
      const res = await deleteBroadcastDraftAction(draft.id);
      if (res.ok) router.push("/dashboard/broadcasts");
      else setSaveError(res.error);
    });
  }

  const primaryLabel = scheduleMode === "later" ? "Programar" : kind === "email" ? "Enviar ahora" : "Poner en cola";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Nombre del broadcast</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={cn(input, "text-base font-medium")} placeholder="Nombre del broadcast" />
        </label>
        <SaveBadge state={saveState} />
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Borrar
        </button>
      </div>
      {saveError && <ErrorLine text={saveError} />}

      {/* 1. Audiencia */}
      <Step n={1} title="A quiénes" hint="Los mismos filtros de la lista de Contactos. Se respeta lo que cada persona del equipo puede ver.">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Buscar contactos</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setMany({ q: e.target.value.slice(0, 100) })}
              placeholder="Nombre, email, teléfono, @usuario…"
              className={cn(input, "pl-8")}
            />
          </label>
          <ContactFiltersPanel
            defs={CONTACT_FILTERS}
            filters={filters}
            options={filterOptions}
            customFields={customFields}
            customFilter={filters.custom ? { slug: filters.custom.field.slug, op: filters.custom.op, value: customFilterRawValue(params) } : null}
            hidden={hasAnonymous ? undefined : new Set(["anon"])}
            activeCount={countMenuFilters(filters)}
            onList={setList}
            onParams={setMany}
            onClear={clearFilters}
          />
        </div>
        {/* Los chips traen el borde y el margen de la barra de Contactos: adentro de la tarjeta, sin eso. */}
        <div className="[&>div]:border-b-0 [&>div]:px-0 [&>div]:py-0 md:[&>div]:px-0">
          <ActiveFilterChips
            defs={CONTACT_FILTERS}
            filters={filters}
            options={filterOptions}
            onRemove={(param) => setList(param, [])}
            onRemoveCustom={() => setMany(Object.fromEntries(CUSTOM_FILTER_PARAMS.map((p) => [p, ""])))}
            onClear={clearFilters}
          />
        </div>
        {countMenuFilters(filters) === 0 && !search && (
          <p className="text-xs text-muted-foreground">Sin filtros, la audiencia son todos los contactos (sin los anónimos).</p>
        )}
      </Step>

      {/* 2. Canal */}
      <Step n={2} title="Por qué canal" hint="WhatsApp sale de a poco, con el ritmo del número. El email sale enseguida, como marketing (con el link de baja).">
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay ningún número de WhatsApp ni email conectado. Conectalos desde Canales.</p>
        ) : (
          <div role="radiogroup" aria-label="Canal" className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => {
              const Icon = c.kind === "whatsapp" ? MessageCircle : Mail;
              const selected = c.id === channelId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setChannelId(c.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                    selected ? "border-primary-edge bg-primary/5 ring-1 ring-primary-edge" : "border-border hover:bg-accent/50",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.label}</span>
                    {c.kind === "whatsapp" && c.connectionStatus && c.connectionStatus !== "connected" && (
                      <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">El número figura {connectionLabel(c.connectionStatus)}.</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {channel && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            {reachState === "loading" && !reach ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Contando…
              </p>
            ) : reachState === "error" ? (
              <ErrorLine text={reachError ?? "No pude contar la audiencia."} />
            ) : reach ? (
              <>
                <p className={cn("text-sm", reachState === "loading" && "opacity-60")}>
                  <span className="text-2xl font-semibold tabular-nums">{reach.reach.sendable.toLocaleString("es")}</span>{" "}
                  {channel.kind === "whatsapp" ? "contactos van a recibir el WhatsApp" : "contactos van a recibir el email"}
                  <span className="text-muted-foreground"> de {reach.reach.total.toLocaleString("es")} que dejan los filtros</span>
                  {reach.truncated && <span className="text-amber-700 dark:text-amber-400"> (la audiencia pasa el máximo de 50.000: afiná los filtros)</span>}
                </p>
                {channel.kind === "whatsapp" && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {reach.reach.linked.toLocaleString("es")} ya escribieron a este número · {reach.reach.phoneOnly.toLocaleString("es")} solo tienen teléfono
                    </p>
                    {reach.reach.phoneOnly > 0 && (
                      <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                        <input type="checkbox" checked={includePhoneOnly} onChange={(e) => setIncludePhoneOnly(e.target.checked)} className="mt-0.5" />
                        <span>
                          Sumar a los {reach.reach.phoneOnly.toLocaleString("es")} que solo tienen teléfono (nunca escribieron a este número).
                          <span className="mt-0.5 block text-xs text-amber-800 dark:text-amber-300">
                            Escribirle en frío a mucha gente es lo que más bloqueos de WhatsApp genera. Usalo con gente que te conoce.
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
                {reach.skippedLabels.filter((s) => !(s.reason === "phone_only_excluded")).length > 0 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {reach.skippedLabels
                      .filter((s) => s.reason !== "phone_only_excluded")
                      .map((s) => (
                        <li key={s.reason}>
                          Quedan afuera {s.count.toLocaleString("es")}: {s.label.toLowerCase()}
                        </li>
                      ))}
                  </ul>
                )}
                <button type="button" onClick={() => setShowSample((v) => !v)} className="text-xs font-medium text-primary-ink underline-offset-2 hover:underline">
                  {showSample ? "Ocultar" : "Ver a quiénes"}
                </button>
                {showSample && (
                  <ul className="max-h-64 divide-y divide-border overflow-auto rounded-lg border border-border bg-background text-sm">
                    {reach.sample.map((s) => (
                      <li key={s.contactId} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <a href={`/dashboard/contacts/${s.contactId}`} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">
                          {s.name}
                        </a>
                        <span className={cn("shrink-0 truncate text-xs", s.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>{s.detail}</span>
                      </li>
                    ))}
                    {reach.reach.total > reach.sample.length && (
                      <li className="px-3 py-1.5 text-xs text-muted-foreground">y {(reach.reach.total - reach.sample.length).toLocaleString("es")} más…</li>
                    )}
                  </ul>
                )}
              </>
            ) : null}
          </div>
        )}
      </Step>

      {/* 3. Mensaje */}
      <Step
        n={3}
        title="El mensaje"
        hint={
          kind === "email"
            ? "Podés usar variables. Si un dato puede faltar, poné un respaldo: {{contact.first_name|hola}}."
            : "Podés usar variables y escribir hasta 5 versiones: a cada contacto le toca una al azar, así WhatsApp no ve el mismo texto repetido."
        }
      >
        {kind === "email" ? (
          <div className="space-y-3">
            {/* La guardia de entrega (00287): si los rebotes y quejas no llegan, el freno no puede funcionar. */}
            <EmailDeliveryNotice />
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Asunto</span>
              <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} maxLength={200} className={input} placeholder="Ej.: {{contact.first_name|Hola}}, tenemos novedades" />
            </label>
            <RichTextEditor
              id={`bc-email-${draft.id}`}
              label="Cuerpo del email"
              value={variants[0] ?? ""}
              onChange={(body) => setVariants([body])}
              variables={[...variableList, "unsubscribe_url"]}
            />
            <p className="text-xs text-muted-foreground">Sale como email de marketing: lleva el link de baja al pie y no le llega a quien se dio de baja.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {variants.map((v, i) => (
              <div key={i}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium">{variants.length > 1 ? `Versión ${i + 1}` : "Mensaje"}</span>
                  {variants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" aria-hidden /> Quitar
                    </button>
                  )}
                </div>
                <textarea
                  ref={(el) => {
                    textareas.current[i] = el;
                  }}
                  value={v}
                  onFocus={() => setFocused(i)}
                  onChange={(e) => setVariants((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                  rows={4}
                  maxLength={4000}
                  aria-label={variants.length > 1 ? `Versión ${i + 1} del mensaje` : "Mensaje"}
                  placeholder="Hola {{contact.first_name|}}, …"
                  className={input}
                />
              </div>
            ))}
            <VariableChips variables={variableList} onInsert={insertVariable} hint="Tocá una variable para agregarla donde está el cursor. Para un respaldo: {{contact.first_name|amigo}}." />
            {variants.length < MAX_VARIANTS && (
              <button
                type="button"
                onClick={() => setVariants((prev) => [...prev, ""])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Otra versión
              </button>
            )}
          </div>
        )}

        {noFallback.length > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={skipMissing} onChange={(e) => setSkipMissing(e.target.checked)} className="mt-0.5" />
            <span>
              Si a un contacto le falta {noFallback.map((p) => `{{${p}}}`).join(", ")}, no mandarle.
              <span className="block text-xs text-muted-foreground">Sin marcar, el dato que falta queda vacío en el mensaje.</span>
            </span>
          </label>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={runMessagePreview}
            disabled={!channel || previewing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Ver cómo les llega
          </button>
          {previewError && <ErrorLine text={previewError} />}
          {messagePreview && (
            <div className="space-y-2">
              {messagePreview.missingCount > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  A {messagePreview.missingCount} de {messagePreview.checked} contactos revisados les falta algún dato.
                </p>
              )}
              {messagePreview.samples.map((s, i) => (
                <div key={i} className="rounded-lg border border-border bg-background p-3 text-sm">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Para {s.name}</p>
                  {s.subject !== null && <p className="mb-1 font-medium">{s.subject}</p>}
                  {kind === "email" ? (
                    // El HTML ya viene limpio del servidor (sanitizeEmailHtml) y trae sus colores en línea (texto oscuro):
                    // se muestra sobre blanco, como en una casilla de correo, también en modo oscuro.
                    <div className="rounded-md bg-white p-3 text-neutral-900" dangerouslySetInnerHTML={{ __html: s.text }} />
                  ) : (
                    <p className="whitespace-pre-wrap">{s.text}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Step>

      {/* 4. Envío */}
      <Step n={4} title="Cuándo y a qué ritmo">
        <div role="radiogroup" aria-label="Cuándo" className="flex flex-wrap gap-2">
          {(
            [
              ["now", "Ahora"],
              ["later", "Programar"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={scheduleMode === mode}
              onClick={() => setScheduleMode(mode)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm",
                scheduleMode === mode ? "border-primary-edge bg-primary/10 font-medium" : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {label}
            </button>
          ))}
          {scheduleMode === "later" && (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Día y hora</span>
              <input type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} className={cn(input, "w-auto")} />
              <span className="text-xs text-muted-foreground">hora del negocio</span>
            </label>
          )}
        </div>

        {channel && effectivePolicy && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {channel.kind === "whatsapp" ? "Ritmo de este número" : "Ritmo del email"}: {describePolicy(channel.policy)}
            </p>
            {channel.kind === "whatsapp" && (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">Ir más lento con este broadcast</summary>
                <p className="mt-1 text-xs text-muted-foreground">Nunca más rápido que el número. El ritmo del número se cambia en Canales.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <NumberField label="Espera mín. (s)" value={pace.minGapSeconds} onChange={(v) => setPace({ ...pace, minGapSeconds: v ?? undefined })} />
                  <NumberField label="Espera máx. (s)" value={pace.maxGapSeconds} onChange={(v) => setPace({ ...pace, maxGapSeconds: v ?? undefined })} />
                  <NumberField label="Máx. por hora" value={pace.perHour ?? undefined} onChange={(v) => setPace({ ...pace, perHour: v })} />
                  <NumberField label="Máx. por día" value={pace.perDay ?? undefined} onChange={(v) => setPace({ ...pace, perDay: v })} />
                </div>
                {paceExceedsCeiling(channel.policy, ownPace) && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Algún valor es más rápido que el número: se usa el del número.</p>
                )}
              </details>
            )}
            {sendable > 0 && etaFrom && (
              <p className="text-sm">
                {eta ? (
                  <>
                    A este ritmo, {sendable.toLocaleString("es")} mensajes terminan de salir aprox. el <strong>{formatEta(eta, timeZone)}</strong>.
                  </>
                ) : (
                  "Con este ritmo no termina en un año: revisá los topes."
                )}
              </p>
            )}
          </div>
        )}

        {problems.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300">
            {problems.map((p) => (
              <li key={p} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {p}
              </li>
            ))}
          </ul>
        )}

        {!confirming ? (
          <button
            type="button"
            disabled={!ready}
            onClick={() => setConfirming(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {primaryLabel}
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border border-primary-edge bg-primary/5 p-3 text-sm">
            <p>
              {scheduleMode === "later" && scheduledIso ? `El ${formatEta(new Date(scheduledIso), timeZone)} empieza a salir` : "Va a empezar a salir"} a{" "}
              <strong>{sendable.toLocaleString("es")}</strong> contactos por <strong>{channel?.label}</strong>. Los contactos se congelan ahora: los que se sumen
              después a los filtros no lo reciben.
            </p>
            {queueError && <ErrorLine text={queueError} />}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={queue}
                disabled={queuing}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {queuing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Confirmar
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
                Volver
              </button>
            </div>
          </div>
        )}
      </Step>
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="space-y-3 rounded-xl border border-border bg-card p-4 md:p-5">
      <header>
        <h2 id={`step-${n}`} className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>
          {title}
        </h2>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | null) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))}
        className={input}
        placeholder="—"
      />
    </label>
  );
}

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {state === "saved" && <Check className="h-3 w-3" aria-hidden />}
      {state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : "No se guardó"}
    </span>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm text-red-700 dark:text-red-400">
      {text}
    </p>
  );
}

function connectionLabel(status: string): string {
  if (status === "disconnected") return "desconectado";
  if (status === "connecting") return "conectándose";
  if (status === "error") return "con error";
  return "sin estado";
}
