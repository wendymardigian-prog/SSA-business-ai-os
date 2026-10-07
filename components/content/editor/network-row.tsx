"use client";

import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { NetworkBadge } from "../network-badge";
import { FormatFiles } from "./format-files";
import {
  INSTAGRAM_CONTENT_TYPES,
  INSTAGRAM_CONTENT_TYPE_LABELS,
  TIKTOK_MODES,
  TIKTOK_MODE_LABELS,
  TIKTOK_PRIVACY,
  TIKTOK_PRIVACY_LABELS,
  YOUTUBE_VISIBILITY,
  YOUTUBE_VISIBILITY_LABELS,
  missingRequiredOptions,
} from "@/lib/content/network-options";
import { createAutomationHref, checkCta, type AutomationRule, type CtaType } from "@/lib/content/keywords";
import { datetimeInputToIso, isoToDatetimeInput } from "@/lib/dates";
import { getFormat } from "@/lib/content/network-format";
import type { NetworkEntry } from "@/lib/content/redistribution";
import type { NetworkSummary } from "@/lib/content/editor";
import type { NetworkValidation } from "@/lib/content/validation";
import type { MediaEntry } from "@/lib/content/media";
import { networkCardView } from "@/lib/content/network-card";
import { networkStateOf, type NetworkPublication } from "@/lib/content/network-state";
import type { ContentPostStatus } from "@/lib/types/database";
import { useState } from "react";

/**
 * La fila de una red en el editor (C8).
 *
 * Antes tenía fecha, caption propio y —solo en YouTube— el título. Todo lo
 * demás estaba en el modelo de datos y no se podía tocar: el CTA, la palabra
 * clave, el publicador, la media propia, y las opciones que cada red EXIGE
 * (por eso TikTok no publicaba y YouTube salía siempre en privado).
 *
 * Cerrada dice lo que hace falta para decidir si abrirla: la red, la fecha,
 * el estado y qué tiene de propio.
 */

const CTA_LABELS: Record<CtaType, string> = {
  none: "Ninguno",
  comment: "Comentar",
  dm: "Mensaje directo",
  link: "Link",
};

const STATE_TONES: Record<string, string> = {
  no_date: "text-muted-foreground",
  tentative: "text-muted-foreground",
  scheduled: "text-blue-600 dark:text-blue-400",
  publishing: "text-blue-600 dark:text-blue-400",
  published: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
};

/** Colores del estado nuevo (Contenido v4, C3): el borde izquierdo de la tarjeta. */
const BORDER_BY_STATE: Record<string, string> = {
  sched: "border-l-4 border-l-blue-500",
  pub: "border-l-4 border-l-emerald-500",
  fail: "border-l-4 border-l-red-500",
};

const PILL_BY_STATE: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  tent: "border border-dashed border-border text-muted-foreground",
  sched: "bg-blue-600 text-white",
  pub: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  fail: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export interface NetworkRowProps {
  postId: string;
  network: NetworkEntry;
  summary: NetworkSummary;
  validation: NetworkValidation;
  publicationStatus: string | null;
  /** La publicacion de esta red, para el estado de 5 valores (Contenido v4, C3). */
  publication: NetworkPublication | undefined;
  /** Si la red tiene cuenta activa CON publicador (C1, C2). */
  connected: boolean;
  /** El estado de la pieza: decide si "el sistema la publica" se puede elegir. */
  postStatus: ContentPostStatus;
  open: boolean;
  editable: boolean;
  canPublish: boolean;
  pending: boolean;
  timeZone: string;
  automations: AutomationRule[];
  channelId: string | null;
  /** Los publicadores disponibles para esa red. */
  publishers: string[];
  /** La biblioteca de archivos de la pieza (F92). */
  library: MediaEntry[];
  /** El formato escrito de la pieza, para sugerir el de la red (F93). */
  pieceFormat: string | null;
  onToggle: () => void;
  onChange: (patch: Partial<NetworkEntry>) => void;
  onRemove: () => void;
  onSchedule: () => void;
  onUnschedule: () => void;
  /** "La subo yo" / "El sistema la publica" (C2). */
  onSetAuto: (auto: boolean) => void;
  /** Marcar como publicado a mano, con la fecha y el link (C3). */
  onMarkPublished: (input: { publishedAt: string | null; url: string | null }) => void;
  onUnmarkPublished: () => void;
}

export function NetworkRow(props: NetworkRowProps) {
  const { network, summary, validation, open, editable, canPublish } = props;
  const options = (network.options ?? {}) as Record<string, unknown>;
  const setOption = (key: string, value: unknown) =>
    props.onChange({ options: { ...options, [key]: value } });

  const cta = network.cta ?? { type: "none" as CtaType, keyword: null };
  const check = checkCta(cta, {
    platform: network.platform,
    channelId: props.channelId,
    rules: props.automations,
  });

  const faltan = missingRequiredOptions(network.platform, options);
  const ownMedia = Array.isArray(network.files) || (network.media !== null && network.media !== undefined);

  // El estado de 5 valores (Contenido v4, C3): lo que decide el chip "a mano",
  // la pastilla, el borde y si se puede programar o marcar como publicado.
  const state = networkStateOf({
    plannedAt: network.planned_at ?? null,
    publication: props.publication,
    connected: props.connected,
  });
  const card = networkCardView({
    connected: props.connected,
    canPublish,
    postStatus: props.postStatus,
    state,
    auto: typeof network.auto === "boolean" ? network.auto : props.publication?.status === "scheduled",
  });

  return (
    <li className={`rounded-lg border border-border ${BORDER_BY_STATE[state.id] ?? ""}`}>
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-accent/40"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <NetworkBadge platform={network.platform} />
            {card.manualChip && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                a mano
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_BY_STATE[state.id] ?? "bg-muted text-muted-foreground"}`}
            >
              {state.label}
            </span>
            {summary.state.includes("·") && (
              <span className={`text-xs ${STATE_TONES[summary.stateKind] ?? "text-muted-foreground"}`}>
                {summary.state.split("·").slice(1).join("·").trim()}
              </span>
            )}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {network.caption !== null && network.caption !== undefined && (
              <Mark>Caption propio</Mark>
            )}
            {network.format ? (
              <Mark>
                {getFormat(network.platform, network.format)?.label ?? network.format}
                {Array.isArray(network.files) && ` · ${network.files.length} archivo${network.files.length === 1 ? "" : "s"}`}
              </Mark>
            ) : (
              ownMedia && <Mark>Variante</Mark>
            )}
            {cta.keyword && <Mark>⚡ {cta.keyword}</Mark>}
            {validation.errors.length > 0 && (
              <span className="text-red-600 dark:text-red-400" title="Hay errores">
                ●
              </span>
            )}
            {!network.caption && !ownMedia && !cta.keyword && <span>{summary.uses}</span>}
          </span>
        </span>

        {summary.hasIssues && (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="Hay avisos" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Fecha y hora en ${network.platform}`} hint="Cada red tiene la suya.">
              <input
                type="datetime-local"
                value={isoToDatetimeInput(network.planned_at ?? null, props.timeZone)}
                onChange={(e) =>
                  props.onChange({ planned_at: datetimeInputToIso(e.target.value, props.timeZone) })
                }
                disabled={!editable && !canPublish}
                className={field}
              />
            </Field>

            <Field label="Publicar por" hint="Por dónde sale esta red.">
              <select
                value={network.publisher ?? ""}
                onChange={(e) => props.onChange({ publisher: e.target.value || null })}
                disabled={!editable}
                className={field}
              >
                <option value="">El de la cuenta</option>
                {props.publishers.map((p) => (
                  <option key={p} value={p}>
                    {PUBLISHER_LABELS[p] ?? p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={`Caption para ${network.platform}`} hint="Vacío = usa el caption base.">
            <textarea
              rows={3}
              value={network.caption ?? ""}
              onChange={(e) => props.onChange({ caption: e.target.value || null })}
              disabled={!editable}
              className={field}
            />
          </Field>

          {network.platform === "youtube" && (
            <Field label="Título del video">
              <input
                value={network.youtube_title ?? ""}
                onChange={(e) => props.onChange({ youtube_title: e.target.value })}
                disabled={!editable}
                className={field}
              />
            </Field>
          )}

          {/* ── Formato y archivos (F93) ── */}
          <FormatFiles
            network={network}
            library={props.library}
            pieceFormat={props.pieceFormat}
            editable={editable}
            onChange={props.onChange}
          />

          {/* ── CTA ── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Llamado a la acción">
              <select
                value={cta.type}
                onChange={(e) =>
                  props.onChange({ cta: { ...cta, type: e.target.value as CtaType } })
                }
                disabled={!editable}
                className={field}
              >
                {(Object.keys(CTA_LABELS) as CtaType[]).map((type) => (
                  <option key={type} value={type}>
                    {CTA_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Palabra clave" hint="La que el lead tiene que escribir.">
              <input
                value={cta.keyword ?? ""}
                onChange={(e) =>
                  props.onChange({ cta: { ...cta, keyword: e.target.value || null } })
                }
                disabled={!editable || cta.type === "none" || cta.type === "link"}
                placeholder={cta.type === "none" ? "—" : "SISTEMA"}
                className={field}
              />
            </Field>
          </div>

          {check && (
            <p
              className={`flex flex-wrap items-center gap-2 rounded-lg p-2 text-xs ${
                check.level === "ok"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : check.level === "warning"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <span>
                {check.level === "ok" ? "⚡ " : "⚠ "}
                {check.message}
              </span>
              {check.match ? (
                <Link
                  href={`/dashboard/flows/${check.match.flowId}`}
                  className="underline underline-offset-2"
                >
                  Ver flow
                </Link>
              ) : (
                check.keyword && (
                  <Link
                    href={createAutomationHref(check, props.channelId)}
                    className="underline underline-offset-2"
                  >
                    Crear automatización
                  </Link>
                )
              )}
            </p>
          )}

          {/* ── Opciones de la red (§9.5) ── */}
          <NetworkOptions
            platform={network.platform}
            options={options}
            disabled={!editable}
            onChange={setOption}
            hideInstagramType={Boolean(network.format)}
          />

          {faltan.map((m) => (
            <p key={m} className="text-xs text-amber-700 dark:text-amber-300">
              ⚠ {m}
            </p>
          ))}
          {/* El error del formato ya esta en su propia linea, arriba. */}
          {validation.errors.filter((e) => !isFormatError(e)).map((e) => (
            <p key={e} className="text-xs text-red-600 dark:text-red-400">
              {e}
            </p>
          ))}
          {validation.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
              {w}
            </p>
          ))}

          {/* ── Como se publica, y marcar como publicado (Contenido v4, C2/C3) ── */}
          <PublishModeBlock
            platform={network.platform}
            state={state}
            card={card}
            pending={props.pending}
            canSchedule={validation.ok && faltan.length === 0}
            timeZone={props.timeZone}
            onSetAuto={props.onSetAuto}
            onMarkPublished={props.onMarkPublished}
            onUnmarkPublished={props.onUnmarkPublished}
          />

          <div className="flex items-center justify-end pt-1">
            {editable && props.publicationStatus === null && (
              <button
                type="button"
                onClick={props.onRemove}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Quitar red
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * "Como se publica en [red]" y "Marcar como publicado" (C2, C3).
 *
 * Las dos opciones del modo son excluyentes: la segunda toca `onSetAuto`, que
 * programa o desprograma de verdad (el servidor valida todo de nuevo, F77).
 * "Marcar como publicado" abre un formulario chico con la fecha y el link.
 */
function PublishModeBlock({
  platform,
  state,
  card,
  pending,
  canSchedule,
  timeZone,
  onSetAuto,
  onMarkPublished,
  onUnmarkPublished,
}: {
  platform: string;
  state: { id: string; label: string; manual: boolean; at: string | null };
  card: ReturnType<typeof networkCardView>;
  pending: boolean;
  canSchedule: boolean;
  timeZone: string;
  onSetAuto: (auto: boolean) => void;
  onMarkPublished: (input: { publishedAt: string | null; url: string | null }) => void;
  onUnmarkPublished: () => void;
}) {
  const [marking, setMarking] = useState(false);
  const [publishedAt, setPublishedAt] = useState(() => isoToDatetimeInput(new Date().toISOString(), timeZone));
  const [url, setUrl] = useState("");

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium">Cómo se publica en {platform}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={card.mode === "self"}
          disabled={pending || Boolean(card.selfDisabledReason)}
          title={card.selfDisabledReason ?? undefined}
          onClick={() => onSetAuto(false)}
          className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs disabled:opacity-50 ${
            card.mode === "self" ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <b className="block">La subo yo</b>
          <span className="text-muted-foreground">
            La fecha queda tentativa: entra al calendario, pero el sistema no publica nada.
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={card.mode === "system"}
          disabled={pending || Boolean(card.systemDisabledReason) || (card.mode !== "system" && !canSchedule)}
          title={card.systemDisabledReason ?? (!canSchedule ? "Revisá los avisos del formato primero." : undefined)}
          onClick={() => onSetAuto(true)}
          className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs disabled:opacity-50 ${
            card.mode === "system" ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <b className="block">El sistema la publica</b>
          <span className="text-muted-foreground">
            {card.systemDisabledReason ?? "A la fecha de arriba se publica sola. Queda en cola."}
          </span>
        </button>
      </div>

      {state.id === "pub" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-emerald-700 dark:text-emerald-400">
            ✓ Publicado{state.manual ? " a mano" : ""}
            {state.at ? ` · ${new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(state.at))}` : ""}
          </span>
          {card.canUndoManual && (
            <button
              type="button"
              disabled={pending}
              onClick={onUnmarkPublished}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Deshacer
            </button>
          )}
        </div>
      ) : marking ? (
        <div className="space-y-2 rounded-lg bg-muted/40 p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Cuándo se publicó">
              <input
                type="datetime-local"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                className={field}
              />
            </Field>
            <Field label="Link del post" hint="Opcional.">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={field} />
            </Field>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onMarkPublished({ publishedAt: datetimeInputToIso(publishedAt, timeZone), url: url.trim() || null });
                setMarking(false);
              }}
              className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setMarking(false)}
              className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        card.canMarkPublished && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMarking(true)}
            className="h-8 rounded-lg border border-border px-3 text-xs disabled:opacity-50"
          >
            Marcar como publicado
          </button>
        )
      )}
    </div>
  );
}

/** Los errores que ya muestra la linea de verificacion del formato. */
function isFormatError(message: string): boolean {
  return /^(Faltan archivos|Sobran archivos|Un archivo no sirve)/.test(message);
}

const PUBLISHER_LABELS: Record<string, string> = {
  zernio: "Zernio",
  postproxy: "Postproxy",
  youtube_api: "API oficial de YouTube",
  linkedin_api: "API de LinkedIn",
  threads_api: "API de Threads",
};

/** Lo propio de cada red (§9.5, A8, A9, A17). */
function NetworkOptions({
  platform,
  options,
  disabled,
  onChange,
  hideInstagramType,
}: {
  platform: string;
  options: Record<string, unknown>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
  /** Con formato elegido, el tipo de Instagram lo decide el formato. */
  hideInstagramType?: boolean;
}) {
  if (platform === "instagram") {
    if (hideInstagramType) return null;
    return (
      <Field label="Tipo">
        <select
          value={String(options.contentType ?? "feed")}
          onChange={(e) => onChange("contentType", e.target.value)}
          disabled={disabled}
          className={field}
        >
          {INSTAGRAM_CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {INSTAGRAM_CONTENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (platform === "tiktok") {
    const draft = options.mode === "draft";
    return (
      <div className="space-y-3 rounded-lg bg-muted/40 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Qué hace TikTok">
            <select
              value={String(options.mode ?? "public")}
              onChange={(e) => onChange("mode", e.target.value)}
              disabled={disabled}
              className={field}
            >
              {TIKTOK_MODES.map((m) => (
                <option key={m} value={m}>
                  {TIKTOK_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>

          {!draft && (
            <Field label="Quién lo puede ver">
              <select
                value={String(options.privacyLevel ?? "")}
                onChange={(e) => onChange("privacyLevel", e.target.value)}
                disabled={disabled}
                className={field}
              >
                <option value="">Elegir…</option>
                {TIKTOK_PRIVACY.map((p) => (
                  <option key={p} value={p}>
                    {TIKTOK_PRIVACY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          {(
            [
              ["allowComment", "Permitir comentarios"],
              ["allowDuet", "Permitir dúos"],
              ["allowStitch", "Permitir stitch"],
            ] as const
          ).map(([key, label]) => (
            <Check
              key={key}
              label={label}
              checked={options[key] !== false}
              disabled={disabled}
              onChange={(v) => onChange(key, v)}
            />
          ))}
        </div>

        {!draft && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              TikTok exige las dos para publicar por API. Sin ellas rechaza el post.
            </p>
            <Check
              label="Vi cómo va a quedar el post"
              checked={options.contentPreviewConfirmed === true}
              disabled={disabled}
              onChange={(v) => onChange("contentPreviewConfirmed", v)}
            />
            <Check
              label="Doy mi consentimiento para publicar por API"
              checked={options.expressConsentGiven === true}
              disabled={disabled}
              onChange={(v) => onChange("expressConsentGiven", v)}
            />
          </div>
        )}
      </div>
    );
  }

  if (platform === "youtube") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Visibilidad">
          <select
            value={String(options.visibility ?? "private")}
            onChange={(e) => onChange("visibility", e.target.value)}
            disabled={disabled}
            className={field}
          >
            {YOUTUBE_VISIBILITY.map((v) => (
              <option key={v} value={v}>
                {YOUTUBE_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end pb-2">
          <Check
            label="Es contenido para niños"
            checked={options.madeForKids === true}
            disabled={disabled}
            onChange={(v) => onChange("madeForKids", v)}
          />
        </div>
      </div>
    );
  }

  return null;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-muted px-1.5 py-0.5">{children}</span>;
}
