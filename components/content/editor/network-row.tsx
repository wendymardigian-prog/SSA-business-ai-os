"use client";

import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { NetworkBadge } from "../network-badge";
import { MediaUploader } from "../media-uploader";
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
import type { NetworkEntry } from "@/lib/content/redistribution";
import type { NetworkSummary } from "@/lib/content/editor";
import type { NetworkValidation } from "@/lib/content/validation";
import type { MediaEntry } from "@/lib/content/media";

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

const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export interface NetworkRowProps {
  postId: string;
  network: NetworkEntry;
  summary: NetworkSummary;
  validation: NetworkValidation;
  publicationStatus: string | null;
  open: boolean;
  editable: boolean;
  canPublish: boolean;
  pending: boolean;
  timeZone: string;
  automations: AutomationRule[];
  channelId: string | null;
  /** Los publicadores disponibles para esa red. */
  publishers: string[];
  onToggle: () => void;
  onChange: (patch: Partial<NetworkEntry>) => void;
  onRemove: () => void;
  onSchedule: () => void;
  onUnschedule: () => void;
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
  const ownMedia = network.media !== null && network.media !== undefined;
  const mediaLocked = !editable;

  return (
    <li className="rounded-lg border border-border">
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
            <span className={`text-xs ${STATE_TONES[summary.stateKind] ?? "text-muted-foreground"}`}>
              {summary.state}
            </span>
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {network.caption !== null && network.caption !== undefined && (
              <Mark>Caption propio</Mark>
            )}
            {ownMedia && <Mark>Variante</Mark>}
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

          {/* ── Media ── */}
          <Field label="Media">
            <>
              <div className="inline-flex rounded-lg border border-border p-0.5">
                <Segment
                  on={!ownMedia}
                  disabled={mediaLocked}
                  onClick={() => props.onChange({ media: null })}
                >
                  Igual a la base
                </Segment>
                <Segment
                  on={ownMedia}
                  disabled={mediaLocked}
                  onClick={() => props.onChange({ media: [] })}
                >
                  Propia de esta red
                </Segment>
              </div>
              {ownMedia && (
                <div className="mt-2">
                  <MediaUploader
                    postId={props.postId}
                    media={(network.media ?? []) as MediaEntry[]}
                    canEdit={editable}
                    platform={network.platform}
                  />
                </div>
              )}
            </>
          </Field>

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
          />

          {faltan.map((m) => (
            <p key={m} className="text-xs text-amber-700 dark:text-amber-300">
              ⚠ {m}
            </p>
          ))}
          {validation.errors.map((e) => (
            <p key={e} className="text-xs text-red-600 dark:text-red-400">
              {e}
            </p>
          ))}
          {validation.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
              {w}
            </p>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {canPublish && (
              <button
                type="button"
                disabled={props.pending || !validation.ok || faltan.length > 0}
                onClick={props.onSchedule}
                className="h-8 rounded-lg border border-border px-3 text-xs disabled:opacity-50"
              >
                Programar solo {network.platform}
              </button>
            )}
            {canPublish && summary.stateKind === "scheduled" && (
              <button
                type="button"
                disabled={props.pending}
                onClick={props.onUnschedule}
                className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-accent"
              >
                Desprogramar
              </button>
            )}
            <span className="flex-1" />
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
}: {
  platform: string;
  options: Record<string, unknown>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  if (platform === "instagram") {
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

function Segment({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
        on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-muted px-1.5 py-0.5">{children}</span>;
}
