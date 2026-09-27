"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react";
import { savePostDraft } from "@/lib/actions/content";
import { requestCopy } from "@/lib/actions/copywriter";
import { scheduleNetworks, unscheduleNetwork } from "@/lib/actions/content-schedule";
import { saveVersion } from "@/lib/actions/content-versions";
import { approvePost, archivePost, requestReview, returnPost } from "@/lib/actions/content-review";
import { setMaterialStatus } from "@/lib/actions/content";
import { MediaUploader } from "@/components/content/media-uploader";
import { VersionHistory } from "@/components/content/version-history";
import { editorActions, summarizeNetwork, type EditorPermissions } from "@/lib/content/editor";
import { validateNetwork } from "@/lib/content/validation";
import { findUppercaseWords, type AutomationRule } from "@/lib/content/keywords";
import { resolveNetworkContent, type NetworkEntry } from "@/lib/content/redistribution";
import type { ExistingPublication } from "@/lib/content/schedule";
import type { MediaEntry } from "@/lib/content/media";
import type { StoredVersion } from "@/lib/content/versions";
import { datetimeInputToIso, isoToDatetimeInput, timeZoneLabel } from "@/lib/dates";
import type { ContentPostStatus } from "@/lib/types/database";
import { NetworkBadge } from "./network-badge";
import { NetworkRow } from "./editor/network-row";
import { NetworkPreview } from "./editor/preview";
import { defaultOptionsFor } from "@/lib/content/network-options";
import { platformLabel } from "@/lib/platforms";

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
  /** De qué idea salió, para poder volver a mirarla (C12). */
  idea: { id: string; title: string } | null;
  /** Si el copywriter está escribiendo esta pieza ahora (E6). */
  copyStatus: "idle" | "generating" | "failed";
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
  publishersByPlatform,
  accountNames,
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
  /** Los publicadores disponibles por red, para "Publicar por". */
  publishersByPlatform: Record<string, string[]>;
  /** Con qué nombre se ve la cuenta en cada red, para la vista previa. */
  accountNames: Record<string, string | null>;
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
  const [material, setMaterial] = useState(post.materialStatus);
  const [showIdea, setShowIdea] = useState(false);

  // Para que "Guardado hace X s" se mueva solo: sin esto diría "hace 0 s"
  // para siempre y nadie sabría si se guardó de verdad.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
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

  /**
   * Las palabras en mayúscula del CTA, y si alguna automatización las
   * contesta (C11).
   */
  const detectedKeywords = useMemo(() => {
    const activas = new Set(
      automations
        .filter((rule) => rule.isActive)
        .flatMap((rule) => rule.keywords.map((k) => k.value.trim().toUpperCase())),
    );
    return findUppercaseWords(draft.copy.cta ?? "").map((word) => ({
      word,
      live: activas.has(word.toUpperCase()),
    }));
  }, [draft.copy.cta, automations]);

  /** Las redes conectadas que esta pieza todavía no tiene (C9). */
  const missingNetworks = connected.filter(
    (platform) => !draft.networks.some((n) => n.platform === platform),
  );

  const conFecha = draft.networks.filter((n) => n.planned_at).length;
  const sinFecha = draft.networks.length - conFecha;

  const previewNetwork =
    draft.networks.find((n) => n.platform === openNetwork) ?? draft.networks[0] ?? null;

  const schedulable = validations.filter((v) => v.ok).length;
  const hasDates = draft.networks.some((n) => n.planned_at);

  const buttons = editorActions({
    status: post.status,
    perms,
    hasDates,
    aiAvailable,
    schedulable,
  });

  /** Lo escrito se guarda antes de cualquier acción que cambie el estado. */
  async function saveActual() {
    dirty.current = false;
    await savePostDraft({
      postId: post.id,
      title: draft.title,
      copy: draft.copy,
      caption: draft.caption,
      networks: draft.networks,
    });
  }

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

        {/* ── Encabezado de la pieza (C12) ── */}
        <div className="space-y-2">
          <input
            value={draft.title}
            onChange={(e) => edit("title", e.target.value)}
            disabled={!editable}
            aria-label="Título de la pieza"
            placeholder="Título interno"
            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold hover:border-border focus:border-border focus:outline-none disabled:opacity-70"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {post.idea && (
              <button
                type="button"
                onClick={() => setShowIdea(true)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-accent"
              >
                💡 Idea: <span className="max-w-[16rem] truncate">{post.idea.title}</span>
                <span className="text-muted-foreground">· ver</span>
              </button>
            )}
            {post.format && (
              <span className="rounded-full border border-border px-2 py-0.5">{post.format}</span>
            )}
          </div>
        </div>

        {/* ── Copy ── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Copy · guion para grabar</h2>
            {post.aiUnreviewed && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                ✦ Generado por el copywriter · revisalo antes de aprobar
              </span>
            )}
          </div>

          {post.copyStatus === "generating" ? (
            <p className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              El copywriter está escribiendo el guion y los captions a partir de la idea…
            </p>
          ) : (
            <>
              {(["hook", "body", "cta", "recording_notes"] as const).map((field) => (
                <Field key={field} label={COPY_LABELS[field]}>
                  <textarea
                    rows={field === "body" ? 8 : 2}
                    value={draft.copy[field] ?? ""}
                    onChange={(e) => edit("copy", { ...draft.copy, [field]: e.target.value })}
                    disabled={!editable}
                    className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                  />
                  {/* Las palabras en mayúscula del CTA son las que el lead va
                      a escribir: que se vean acá evita descubrir publicando
                      que ninguna dispara nada (C11). */}
                  {field === "cta" && detectedKeywords.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">Palabras clave detectadas:</span>
                      {detectedKeywords.map(({ word, live }) => (
                        <span
                          key={word}
                          className={
                            live
                              ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400"
                              : "rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300"
                          }
                          title={
                            live
                              ? "Dispara una automatización activa"
                              : "Ninguna automatización responde a esta palabra"
                          }
                        >
                          {live ? "⚡ " : "⚠ "}
                          {word}
                        </span>
                      ))}
                    </span>
                  )}
                </Field>
              ))}

              {/* Sin esto una pieza nunca pasa a "En producción": el estado
                  existía en la base y no había dónde tocarlo (C7). */}
              <Field label="Estado del material">
                <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5">
                  {(Object.keys(MATERIAL_LABELS) as Array<keyof typeof MATERIAL_LABELS>).map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={material === value}
                        disabled={!editable || pending}
                        onClick={() => {
                          setMaterial(value);
                          run(() => setMaterialStatus(post.id, value));
                        }}
                        className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
                          material === value
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {MATERIAL_LABELS[value]}
                      </button>
                    ),
                  )}
                </div>
              </Field>
            </>
          )}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Redes y publicación</h2>
            <p className="text-xs text-muted-foreground">
              Fecha, caption, media, CTA y opciones de cada red
            </p>
          </div>

          {draft.networks.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
              {connected.length === 0
                ? "Todavía no hay ninguna red conectada. Conectá una en Integraciones para poder programar."
                : "Esta pieza todavía no tiene redes. Agregá una acá abajo."}
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

                return (
                  <NetworkRow
                    key={network.platform}
                    postId={post.id}
                    network={network}
                    summary={summary}
                    validation={validation}
                    publicationStatus={publication?.status ?? null}
                    open={openNetwork === network.platform}
                    editable={editable}
                    canPublish={perms.publish}
                    pending={pending}
                    timeZone={timeZone}
                    automations={automations}
                    channelId={channelIdByPlatform[network.platform] ?? null}
                    publishers={publishersByPlatform[network.platform] ?? []}
                    onToggle={() =>
                      setOpenNetwork(openNetwork === network.platform ? null : network.platform)
                    }
                    onChange={(patch) =>
                      edit(
                        "networks",
                        draft.networks.map((n, i) => (i === index ? { ...n, ...patch } : n)),
                      )
                    }
                    onRemove={() =>
                      edit(
                        "networks",
                        draft.networks.filter((_, i) => i !== index),
                      )
                    }
                    onSchedule={() =>
                      run(
                        () => scheduleNetworks({ postId: post.id, platform: network.platform }),
                        `${network.platform} programado.`,
                      )
                    }
                    onUnschedule={() =>
                      run(
                        () => unscheduleNetwork({ postId: post.id, platform: network.platform }),
                        "Desprogramada. La fecha queda guardada.",
                      )
                    }
                  />
                );
              })}
            </ul>
          )}

          {/* Agregar una red conectada que la pieza todavía no tiene (C9). */}
          {editable && missingNetworks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {missingNetworks.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => {
                    edit("networks", [
                      ...draft.networks,
                      { platform, planned_at: null, options: defaultOptionsFor(platform) },
                    ]);
                    setOpenNetwork(platform);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  + <NetworkBadge platform={platform} variant="dot" size="sm" />
                  {platformLabel(platform)}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className="space-y-6">
        {/* Cómo va a quedar, en la red abierta (C10). Va arriba del
            historial: es lo que se mira mientras se escribe. */}
        {previewNetwork && (
          <NetworkPreview
            platform={previewNetwork.platform}
            caption={previewNetwork.caption ?? draft.caption}
            media={
              previewNetwork.media !== null && previewNetwork.media !== undefined
                ? (previewNetwork.media as MediaEntry[])
                : post.media
            }
            title={previewNetwork.platform === "youtube" ? previewNetwork.youtube_title : null}
            variant={previewNetwork.media !== null && previewNetwork.media !== undefined}
            accountName={accountNames[previewNetwork.platform] ?? null}
          />
        )}

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

      {/* El pie fijo: lo que falta y lo que se puede hacer, siempre a la
          vista. Antes los botones estaban arriba del formulario y en una
          pieza larga quedaban fuera de pantalla (C6). */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 xl:col-span-2">
        <span className="text-xs text-muted-foreground">
          {conFecha} de {draft.networks.length} redes con fecha
          {sinFecha > 0 && ` · ${sinFecha} sin fecha`}
        </span>
        {savedAt && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3" aria-hidden />
            Guardado {haceCuanto(savedAt, now)}
          </span>
        )}
        <span className="flex-1" />
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
            {button.action === "generate_copy" && !pending && (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {button.label}
          </button>
        ))}
      </div>

      {showIdea && post.idea && (
        <IdeaPeek ideaId={post.idea.id} onClose={() => setShowIdea(false)} />
      )}
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

      // Las cuatro que antes contestaban "eso se hace desde el detalle" (C5).
      // Un Member no tenía forma de mandar su pieza a revisión desde acá, que
      // es donde la estaba escribiendo.
      case "send_to_review":
        run(async () => {
          await saveActual();
          return requestReview({ postId: post.id });
        }, "La mandaste a revisión.");
        break;

      case "approve":
        run(() => approvePost({ postId: post.id }), "Aprobada.");
        break;

      case "return_to_draft": {
        const comment = window.prompt("¿Qué hay que cambiar? (se lo ve quien la escribió)");
        if (comment === null) return;
        run(() => returnPost({ postId: post.id, comment }), "Devuelta a producción.");
        break;
      }

      case "archive":
        if (!window.confirm("¿Archivar esta pieza? Sale del tablero y queda en el historial.")) {
          return;
        }
        run(async () => {
          const result = await archivePost({ postId: post.id });
          if (result.ok) router.push("/dashboard/content");
          return result;
        }, "Archivada.");
        break;

      default:
        setMessage({ tone: "info", text: "Esa acción todavía no está." });
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


const MATERIAL_LABELS = {
  pendiente: "Sin grabar",
  grabado: "Grabado",
  editado: "Editado",
  listo: "Listo",
} as const;

/** "hace 8 s", "hace 3 min". Lo que dice si se guardó de verdad. */
function haceCuanto(iso: string, now: number): string {
  const segundos = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (segundos < 60) return `hace ${segundos} s`;
  return `hace ${Math.round(segundos / 60)} min`;
}

/** El detalle de la idea, desde el editor (C12). */
function IdeaPeek({ ideaId, onClose }: { ideaId: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Idea de origen"
        className="w-full max-w-md rounded-2xl border border-border bg-background p-4"
      >
        <p className="text-sm">
          Esta pieza salió de una idea. Podés verla completa en el tablero.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cerrar
          </button>
          <a
            href={`/dashboard/content?idea=${ideaId}`}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Ver en el tablero
          </a>
        </div>
      </div>
    </div>
  );
}
