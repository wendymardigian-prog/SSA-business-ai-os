"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react";
import { savePostDraft } from "@/lib/actions/content";
import { requestCopy } from "@/lib/actions/copywriter";
import { scheduleNetworks, unscheduleNetwork } from "@/lib/actions/content-schedule";
import { saveVersion } from "@/lib/actions/content-versions";
import { MediaUploader } from "@/components/content/media-uploader";
import { VersionHistory } from "@/components/content/version-history";
import { editorActions, summarizeNetwork, type EditorPermissions } from "@/lib/content/editor";
import { validateNetwork } from "@/lib/content/validation";
import { checkCta, type AutomationRule } from "@/lib/content/keywords";
import { resolveNetworkContent, type NetworkEntry } from "@/lib/content/redistribution";
import type { ExistingPublication } from "@/lib/content/schedule";
import type { MediaEntry } from "@/lib/content/media";
import type { StoredVersion } from "@/lib/content/versions";
import { datetimeInputToIso, isoToDatetimeInput, timeZoneLabel } from "@/lib/dates";
import type { ContentPostStatus } from "@/lib/types/database";
import { NetworkBadge } from "./network-badge";

/**
 * El editor de la pieza, en una sola pagina (F24).
 *
 * Orden de las secciones: Copy → Caption base → Media base → Redes. Es el
 * orden en que se trabaja: primero que vas a decir, despues como lo contas,
 * despues con que, y al final donde sale.
 *
 * Autoguardado cada 10 segundos. No crea versiones (eso lo decide
 * `versionReasonFor`): guardar una version por autoguardado llenaria el
 * historial de ruido.
 */

export interface EditorPost {
  id: string;
  title: string;
  format: string | null;
  copy: { hook?: string; body?: string; cta?: string; recording_notes?: string };
  caption: string | null;
  networks: NetworkEntry[];
  media: MediaEntry[];
  status: ContentPostStatus;
  materialStatus: string;
  aiUnreviewed: boolean;
  updatedAt: string;
}

const AUTOSAVE_MS = 10_000;

export function PostEditor({
  post,
  perms,
  publications,
  connected,
  automations,
  channelIdByPlatform,
  versions,
  authorNames,
  aiAvailable,
  timeZone,
}: {
  post: EditorPost;
  perms: EditorPermissions;
  publications: ExistingPublication[];
  connected: string[];
  automations: AutomationRule[];
  channelIdByPlatform: Record<string, string | null>;
  versions: StoredVersion[];
  authorNames: Record<string, string>;
  aiAvailable: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [openNetwork, setOpenNetwork] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    title: post.title,
    copy: { hook: "", body: "", cta: "", recording_notes: "", ...post.copy },
    caption: post.caption ?? "",
    networks: post.networks,
  });

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dirty = useRef(false);
  const lastEdited = useRef<string | null>(null);

  const editable = ["draft", "in_production", "in_review"].includes(post.status);

  // ── Autoguardado ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editable) return;
    const timer = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      void savePostDraft({
        postId: post.id,
        title: draft.title,
        copy: draft.copy,
        caption: draft.caption,
        networks: draft.networks,
        knownUpdatedAt: post.updatedAt,
      }).then((result) => {
        if (result.ok) {
          setSavedAt(new Date().toISOString());
          if (result.data.staleWarning) {
            setMessage({
              tone: "info",
              text: "Alguien mas edito esta pieza mientras la tenias abierta. Se guardo lo tuyo; conviene recargar para ver lo suyo.",
            });
          }
        }
      });
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [draft, editable, post.id, post.updatedAt]);

  // Avisar al cerrar con cambios sin guardar.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function edit<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    dirty.current = true;
    lastEdited.current = new Date().toISOString();
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // ── Validacion por red, en vivo ─────────────────────────────────────────
  const validations = useMemo(() => {
    return draft.networks.map((network) => {
      const resolved = resolveNetworkContent({
        network,
        baseCaption: draft.caption,
        baseMedia: post.media,
      });
      return validateNetwork({
        platform: network.platform,
        text: resolved.caption,
        media: resolved.media,
        title: network.youtube_title,
        options: network.options,
      });
    });
  }, [draft.networks, draft.caption, post.media]);

  const schedulable = validations.filter((v) => v.ok).length;
  const hasDates = draft.networks.some((n) => n.planned_at);

  const buttons = editorActions({
    status: post.status,
    perms,
    hasDates,
    aiAvailable,
    schedulable,
  });

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okText?: string) {
    startTransition(async () => {
      const result = await action();
      setMessage(
        result.ok
          ? okText
            ? { tone: "ok", text: okText }
            : null
          : { tone: "error", text: result.error ?? "No se pudo" },
      );
      router.refresh();
    });
  }

  return (
    <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        {post.aiUnreviewed && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            ✦ Generado con IA · revisalo antes de aprobar.
          </p>
        )}

        {message && (
          <p
            role="alert"
            className={`rounded-lg p-3 text-xs ${
              message.tone === "error"
                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : message.tone === "ok"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {message.text}
          </p>
        )}

        {/* ── Barra de acciones ── */}
        <div className="flex flex-wrap items-center gap-2">
          {buttons.map((button) => (
            <button
              key={button.action}
              type="button"
              disabled={pending || Boolean(button.disabledReason)}
              title={button.disabledReason}
              onClick={() => onAction(button.action)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${
                button.tone === "primary"
                  ? "bg-primary text-primary-foreground"
                  : button.tone === "danger"
                    ? "border border-border text-muted-foreground"
                    : "border border-border"
              }`}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {button.action === "generate_copy" && !pending && <Sparkles className="h-4 w-4" aria-hidden />}
              {button.label}
            </button>
          ))}
          {savedAt && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3 w-3" aria-hidden />
              Guardado
            </span>
          )}
        </div>

        {/* ── Copy ── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Copy (el guion para grabar)</h2>
          <Field label="Titulo de la pieza">
            <input
              value={draft.title}
              onChange={(e) => edit("title", e.target.value)}
              disabled={!editable}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            />
          </Field>
          {(["hook", "body", "cta", "recording_notes"] as const).map((field) => (
            <Field key={field} label={COPY_LABELS[field]}>
              <textarea
                rows={field === "body" ? 8 : 2}
                value={draft.copy[field] ?? ""}
                onChange={(e) => edit("copy", { ...draft.copy, [field]: e.target.value })}
                disabled={!editable}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
              />
            </Field>
          ))}
        </section>

        {/* ── Caption base ── */}
        <section>
          <h2 className="text-sm font-semibold">Caption base</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            El que usan todas las redes salvo que tengan uno propio.
          </p>
          <textarea
            rows={4}
            value={draft.caption}
            onChange={(e) => edit("caption", e.target.value)}
            disabled={!editable}
            className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm"
          />
        </section>

        {/* ── Media base ── */}
        <section>
          <h2 className="text-sm font-semibold">Media base</h2>
          <div className="mt-2">
            <MediaUploader postId={post.id} media={post.media} canEdit={editable} />
          </div>
        </section>

        {/* ── Redes ── */}
        <section>
          <h2 className="text-sm font-semibold">Redes y publicacion</h2>
          {draft.networks.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
              {connected.length === 0
                ? "Todavia no hay ninguna red conectada. Conecta una en Integraciones para poder programar."
                : "Esta pieza todavia no tiene redes. Agrega una para elegir cuando sale."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {draft.networks.map((network, index) => {
                const validation = validations[index];
                const publication = publications.find((p) => p.platform === network.platform);
                const summary = summarizeNetwork({
                  network,
                  publication,
                  timeZone,
                  errors: validation.errors.length,
                  warnings: validation.warnings.length,
                });
                const open = openNetwork === network.platform;
                const cta = checkCta(network.cta ?? { type: "none" }, {
                  platform: network.platform,
                  channelId: channelIdByPlatform[network.platform] ?? null,
                  rules: automations,
                });

                return (
                  <li key={network.platform} className="rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => setOpenNetwork(open ? null : network.platform)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-2 p-3 text-left"
                    >
                      <span className="min-w-0">
                        <NetworkBadge platform={network.platform} />
                        <span className="ml-2 text-xs text-muted-foreground">{summary.state}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {summary.uses}
                          {summary.cta && ` · ${summary.cta}`}
                        </span>
                      </span>
                      {summary.hasIssues && (
                        <AlertTriangle
                          className="h-4 w-4 flex-shrink-0 text-amber-500"
                          aria-label="Hay avisos"
                        />
                      )}
                    </button>

                    {open && (
                      <div className="space-y-3 border-t border-border p-3">
                        <Field
                          label="Fecha y hora"
                          hint={`Hora de ${timeZone} (${timeZoneLabel(timeZone)}).`}
                        >
                          <input
                            type="datetime-local"
                            value={isoToDatetimeInput(network.planned_at ?? null, timeZone)}
                            onChange={(e) =>
                              edit(
                                "networks",
                                draft.networks.map((n, i) =>
                                  i === index
                                    ? {
                                        ...n,
                                        planned_at: datetimeInputToIso(e.target.value, timeZone),
                                      }
                                    : n,
                                ),
                              )
                            }
                            disabled={!perms.publish && !editable}
                            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
                          />
                        </Field>

                        <Field label="Caption propio" hint="Vacio = usa el caption base.">
                          <textarea
                            rows={3}
                            value={network.caption ?? ""}
                            onChange={(e) =>
                              edit(
                                "networks",
                                draft.networks.map((n, i) =>
                                  i === index ? { ...n, caption: e.target.value || null } : n,
                                ),
                              )
                            }
                            disabled={!editable}
                            className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                          />
                        </Field>

                        {network.platform === "youtube" && (
                          <Field label="Titulo del video">
                            <input
                              value={network.youtube_title ?? ""}
                              onChange={(e) =>
                                edit(
                                  "networks",
                                  draft.networks.map((n, i) =>
                                    i === index ? { ...n, youtube_title: e.target.value } : n,
                                  ),
                                )
                              }
                              disabled={!editable}
                              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
                            />
                          </Field>
                        )}

                        {cta && (
                          <p
                            className={`rounded-lg p-2 text-xs ${
                              cta.level === "ok"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : cta.level === "warning"
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {cta.level === "ok" ? "✓ " : "⚠ "}
                            {cta.message}
                          </p>
                        )}

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

                        {perms.publish && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={pending || !validation.ok}
                              onClick={() =>
                                run(
                                  () =>
                                    scheduleNetworks({ postId: post.id, platform: network.platform }),
                                  `${network.platform} programado.`,
                                )
                              }
                              className="h-8 rounded-lg border border-border px-3 text-xs disabled:opacity-50"
                            >
                              Programar solo esta red
                            </button>
                            {summary.stateKind === "scheduled" && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    () =>
                                      unscheduleNetwork({
                                        postId: post.id,
                                        platform: network.platform,
                                      }),
                                    "Desprogramada. La fecha queda guardada.",
                                  )
                                }
                                className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-accent"
                              >
                                Desprogramar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-6">
        <VersionHistory
          postId={post.id}
          versions={versions}
          current={{
            title: draft.title,
            format: post.format,
            copy: draft.copy,
            caption: draft.caption,
            networks: draft.networks,
            media: post.media,
          }}
          authorNames={authorNames}
          canEdit={editable}
        />
      </aside>
    </div>
  );

  function onAction(action: string) {
    switch (action) {
      case "save_version":
        run(
          async () => {
            await savePostDraft({
              postId: post.id,
              title: draft.title,
              copy: draft.copy,
              caption: draft.caption,
              networks: draft.networks,
            });
            return saveVersion({ postId: post.id, context: { trigger: "manual_save" } });
          },
          "Version guardada.",
        );
        break;

      case "generate_copy":
        run(async () => {
          // El copywriter escribe en segundo plano: esto encola y vuelve. La
          // pieza queda diciendo que esta escribiendo y se refresca sola.
          const first = await requestCopy({ postId: post.id });
          if (!first.ok && first.needsConfirmation) {
            // Pisar el guion de alguien sin preguntar es lo que hace que una
            // funcion util deje de usarse.
            if (!window.confirm(`${first.error} ¿Sigo?`)) return { ok: true };
            return requestCopy({ postId: post.id, confirmed: true });
          }
          return first;
        }, "El copywriter esta escribiendo. Te aviso cuando termine.");
        break;

      case "schedule":
        run(() => scheduleNetworks({ postId: post.id }), "Programado.");
        break;

      case "publish_now":
        if (!window.confirm("¿Publicar ahora en las redes con fecha?")) return;
        run(() => scheduleNetworks({ postId: post.id, now: true }), "Saliendo.");
        break;

      default:
        setMessage({ tone: "info", text: "Eso se hace desde el detalle de la pieza." });
    }
  }
}

const COPY_LABELS = {
  hook: "Hook (la primera frase)",
  body: "Desarrollo",
  cta: "Cierre y llamado a la accion",
  recording_notes: "Notas de grabacion",
} as const;

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

