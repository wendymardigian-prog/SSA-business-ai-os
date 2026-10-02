"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Mic, Upload, Search } from "lucide-react";
import {
  createAsset,
  updateAsset,
  deleteAsset,
  correctTranscript,
  requestAssetUpload,
  type AssetUploadTicket,
} from "@/lib/actions/response-assets";
import { filterAssets } from "@/lib/response-assets/search";
import { ASSET_KIND_LABEL, type AssetKind } from "@/lib/response-assets/kind";
import { AssetKindIcon } from "@/components/response-assets/asset-kind-icon";
import { TEMPLATE_VARIABLES, PREVIEW_CONTEXT, interpolateTemplate } from "@/lib/templates/interpolate";
import { createClient } from "@/lib/supabase/client";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { headBase64Of } from "@/lib/content/media";
import { VoiceRecorder } from "@/components/inbox/voice-recorder";
import { formatRecordingDuration } from "@/lib/audio/recording";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionError, EmptyHint } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";

/**
 * Pantalla de la banca de recursos: una tabla para textos y audios juntos,
 * con pestañas para filtrar por tipo y un buscador que reutiliza la misma
 * funcion que el picker "/" de la bandeja (filterAssets).
 *
 * Fusiona templates-view.tsx y audios-view.tsx (mismo esqueleto: tabla +
 * modal). El `kind` se elige una sola vez, al crear, con un <select> arriba
 * del formulario (mismo patron que el tipo de un campo personalizado en
 * custom-fields-view.tsx); al editar queda fijo, porque convertir un texto
 * en audio no es editar, es crear otra cosa.
 */

export interface AssetRow {
  id: string;
  kind: AssetKind;
  name: string;
  shortcut: string | null;
  description: string | null;
  tags: string[];
  content: string | null;
  storagePath: string | null;
  mimeType: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  transcriptStatus: "none" | "pending" | "ready" | "failed";
  agentEnabled: boolean;
  isActive: boolean;
  source: string | null;
}

type KindFilter = "all" | AssetKind;

function audioUrl(path: string): string {
  return `/api/v1/chat-media?path=${encodeURIComponent(path)}`;
}

function durationLabel(seconds: number | null): string {
  if (seconds == null) return "—";
  return formatRecordingDuration(seconds);
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function RecursosView({
  assets,
  canManage,
  workspaceName,
}: {
  assets: AssetRow[];
  canManage: boolean;
  workspaceName: string;
}) {
  const [filter, setFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AssetRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<AssetRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const byKind = filter === "all" ? assets : assets.filter((a) => a.kind === filter);
  const visible = query.trim() ? filterAssets(byKind, query) : byKind;

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    start(async () => {
      const result = await deleteAsset(target.id);
      setDeleting(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleAgentEnabled(asset: AssetRow) {
    if (asset.kind === "audio" && asset.transcriptStatus !== "ready") return;
    start(async () => {
      const result = await updateAsset(asset.id, {
        name: asset.name,
        shortcut: asset.shortcut,
        description: asset.description,
        tags: asset.tags,
        ...(asset.kind === "text" ? { content: asset.content ?? "" } : {}),
        agentEnabled: !asset.agentEnabled,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader
        route="/dashboard/settings/recursos"
        backHref={
          <Link
            href="/dashboard/settings"
            aria-label="Volver a Ajustes"
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        left={
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            {(["all", "text", "audio"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === k ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "all" ? "Todos" : k === "text" ? "Textos" : "Audios"}
              </button>
            ))}
          </div>
        }
        right={
          <div className="flex items-center gap-2">
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar..."
                className="h-9 w-48 rounded-lg border border-input bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {canManage && (
              <button
                onClick={() => {
                  setError(null);
                  setEditing("new");
                }}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Nuevo recurso</span>
              </button>
            )}
          </div>
        }
      />
      {/* Un Member entra a Recursos para usarlos, no para administrar
          Ajustes: sin las pestañas no le ofrecemos links a pantallas de
          admin que lo van a rebotar. */}
      {canManage && <SettingsTabs />}
      {error && (
        <div className="px-4 pt-4 md:px-8">
          <ActionError message={error} />
        </div>
      )}

      <div className="flex-1">
        {assets.length === 0 ? (
          <SettingsEmptyState
            description={
              canManage ? SETTINGS_EMPTY_STATES.recursosAdmin : SETTINGS_EMPTY_STATES.recursosMember
            }
            action={
              canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setEditing("new");
                  }}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Nuevo recurso
                </button>
              )
            }
          />
        ) : visible.length === 0 ? (
          <div className="px-8 py-12">
            <EmptyHint>Ningún recurso coincide con la búsqueda.</EmptyHint>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-8 py-3 text-xs font-medium uppercase text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Nombre</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Atajo</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Etiquetas</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Contenido</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Asistente</th>
                {canManage && <th className="w-24 px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {visible.map((asset) => (
                <tr key={asset.id} className="border-b border-border align-top">
                  <td className="px-8 py-3">
                    <AssetKindIcon kind={asset.kind} className="h-4 w-4 text-muted-foreground" />
                  </td>
                  <td className="px-4 py-3 text-sm font-medium">{asset.name}</td>
                  <td className="px-4 py-3">
                    {asset.shortcut ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{asset.shortcut}</code>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {asset.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {asset.tags.map((tag) => (
                          <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    {asset.kind === "text" ? (
                      <span className="block truncate text-sm text-muted-foreground">{asset.content}</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <audio
                          controls
                          preload="none"
                          src={audioUrl(asset.storagePath ?? "")}
                          className="h-9 w-48 max-w-full dark:[color-scheme:dark]"
                        />
                        {asset.transcriptStatus === "ready" ? (
                          <span className="block truncate text-xs text-muted-foreground" title={asset.transcript ?? ""}>
                            {asset.transcript}
                          </span>
                        ) : asset.transcriptStatus === "failed" ? (
                          <span className="text-xs text-destructive">No se pudo transcribir</span>
                        ) : (
                          <span className="text-xs italic text-muted-foreground">
                            Transcribiendo… ({durationLabel(asset.durationSeconds)})
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleAgentEnabled(asset)}
                      disabled={!canManage || pending || (asset.kind === "audio" && asset.transcriptStatus !== "ready")}
                      title={
                        asset.kind === "audio" && asset.transcriptStatus !== "ready"
                          ? "El agente solo puede usar un audio con la transcripción lista"
                          : asset.agentEnabled
                            ? "El agente lo puede usar solo"
                            : "El agente no lo usa"
                      }
                      className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        asset.agentEnabled ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
                          asset.agentEnabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setError(null);
                            setEditing(asset);
                          }}
                          aria-label={`Editar ${asset.name}`}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleting(asset)}
                          aria-label={`Eliminar ${asset.name}`}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <AssetDialog
          asset={editing}
          workspaceName={workspaceName}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar recurso"
        message={
          deleting
            ? `Se elimina "${deleting.name}". Deja de aparecer en la bandeja y el agente deja de usarlo.`
            : ""
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** Sube un archivo ya elegido (grabado o del disco) y devuelve su ticket firmado. */
async function uploadAsset(file: Blob, declaredMime?: string): Promise<AssetUploadTicket> {
  const ticket = await requestAssetUpload({
    sizeBytes: file.size,
    headBase64: await headBase64Of(file),
    declaredMime,
  });
  if (!ticket.ok) throw new Error(ticket.error);

  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .uploadToSignedUrl(ticket.ticket.path, ticket.ticket.token, file, { contentType: ticket.ticket.mime });

  if (uploadError) throw new Error("No se pudo subir el archivo. Probá de nuevo.");

  return ticket.ticket;
}

function AssetDialog({
  asset,
  workspaceName,
  onClose,
  onSaved,
}: {
  asset: AssetRow | "new";
  workspaceName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = asset === "new";
  const existing = isNew ? null : asset;

  // El tipo se elige una sola vez, al crear. Al editar queda fijo: convertir
  // un texto en audio no es editar, es crear otra cosa.
  const [kind, setKind] = useState<AssetKind>(existing?.kind ?? "text");

  const [name, setName] = useState(existing?.name ?? "");
  const [shortcut, setShortcut] = useState(existing?.shortcut ?? "");
  const [tagsText, setTagsText] = useState((existing?.tags ?? []).join(", "));
  const [description, setDescription] = useState(existing?.description ?? "");
  const [content, setContent] = useState(existing?.content ?? "");

  const [transcript, setTranscript] = useState(existing?.transcript ?? "");
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [mode, setMode] = useState<"record" | "upload" | null>(null);
  const [newFile, setNewFile] = useState<
    { blob: Blob; mime: string; durationSeconds: number | null; source: "recorded" | "uploaded" } | null
  >(null);

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // La vista previa usa el nombre real del negocio y datos de ejemplo para el
  // contacto: es lo mas parecido a lo que va a leer el lead.
  const preview = interpolateTemplate(content, { ...PREVIEW_CONTEXT, workspace: { name: workspaceName } });

  function submit() {
    setError(null);
    start(async () => {
      try {
        const tags = parseTags(tagsText);

        if (kind === "text") {
          const result = existing
            ? await updateAsset(existing.id, { name, shortcut, description: description || null, tags, content })
            : await createAsset({ kind: "text", name, shortcut, description: description || null, tags, content });
          if (!result.ok) {
            setError(result.error);
            return;
          }
        } else {
          let replacement: { storagePath: string; mimeType: string; durationSeconds?: number | null } | undefined;
          if (newFile) {
            const ticket = await uploadAsset(newFile.blob, newFile.mime);
            replacement = { storagePath: ticket.path, mimeType: ticket.mime, durationSeconds: newFile.durationSeconds };
          }

          if (existing) {
            const result = await updateAsset(existing.id, {
              name, shortcut, description, tags,
              ...(replacement ? { replacement } : {}),
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
          } else {
            if (!replacement || !newFile) {
              setError("Grabá o subí un audio");
              return;
            }
            const result = await createAsset({
              kind: "audio",
              name, shortcut, description, tags,
              storagePath: replacement.storagePath,
              mimeType: replacement.mimeType,
              durationSeconds: replacement.durationSeconds,
              source: newFile.source,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
          }
        }

        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Algo salió mal");
      }
    });
  }

  function saveTranscript() {
    if (!existing) return;
    setError(null);
    start(async () => {
      const result = await correctTranscript(existing.id, transcript);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingTranscript(false);
    });
  }

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewFile({ blob: file, mime: file.type || "application/octet-stream", durationSeconds: null, source: "uploaded" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">
          {isNew ? "Nuevo recurso" : kind === "text" ? "Editar texto" : "Editar audio"}
        </h2>

        {isNew && (
          <div className="mt-4">
            <label htmlFor="asset-kind" className="mb-1 block text-xs font-medium text-muted-foreground">
              Tipo de recurso
            </label>
            <select
              id="asset-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as AssetKind)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="text">{ASSET_KIND_LABEL.text}</option>
              <option value="audio">{ASSET_KIND_LABEL.audio}</option>
            </select>
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="asset-name" className="mb-1 block text-xs font-medium text-muted-foreground">
              Nombre
            </label>
            <input
              id="asset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Precio del servicio"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="asset-shortcut" className="mb-1 block text-xs font-medium text-muted-foreground">
              Atajo (opcional)
            </label>
            <input
              id="asset-shortcut"
              value={shortcut ?? ""}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="/precio"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="asset-tags" className="mb-1 block text-xs font-medium text-muted-foreground">
            Etiquetas (opcional)
          </label>
          <input
            id="asset-tags"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="precios, objeciones"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground/70">Separadas por coma. Se buscan igual que el nombre.</p>
        </div>

        <div className="mt-3">
          <label htmlFor="asset-description" className="mb-1 block text-xs font-medium text-muted-foreground">
            {kind === "audio" ? "Descripción (para la IA)" : "Descripción (opcional, para la IA)"}
          </label>
          <textarea
            id="asset-description"
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Cuándo preguntan cuánto cuesta el servicio"
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground/70">
            No es para quien lo recibe: es lo que el agente lee para decidir cuándo usar este recurso solo.
          </p>
        </div>

        {kind === "text" ? (
          <>
            <div className="mt-3">
              <label htmlFor="asset-content" className="mb-1 block text-xs font-medium text-muted-foreground">
                Texto
              </label>
              <textarea
                id="asset-content"
                value={content ?? ""}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                placeholder="Hola {{contact.display_name}}, gracias por escribir a {{workspace.name}}."
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">Variables disponibles</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() => setContent(`${content}{{${variable.key}}}`)}
                    title={`${variable.label} — clic para agregarla al final`}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:bg-accent"
                  >
                    {`{{${variable.key}}}`}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground/70">
                Si el contacto no tiene ese dato cargado, la variable queda vacía.
              </p>
            </div>

            {content.trim() && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Así se ve con datos de ejemplo</p>
                <p className="whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  {preview}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {existing ? "Reemplazar archivo (opcional)" : "Archivo"}
              </p>

              {existing && !mode && !newFile && (
                <audio
                  controls
                  preload="none"
                  src={audioUrl(existing.storagePath ?? "")}
                  className="mb-2 h-9 w-full dark:[color-scheme:dark]"
                />
              )}

              {newFile ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <audio controls autoPlay={false} src={URL.createObjectURL(newFile.blob)} className="h-9 flex-1 dark:[color-scheme:dark]" />
                  <button
                    type="button"
                    onClick={() => {
                      setNewFile(null);
                      setMode(null);
                    }}
                    className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    Descartar
                  </button>
                </div>
              ) : mode === "record" ? (
                <VoiceRecorder
                  onSend={(file, mime, durationSeconds) => {
                    setNewFile({ blob: file, mime, durationSeconds, source: "recorded" });
                    setMode(null);
                  }}
                  onCancel={() => setMode(null)}
                />
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("record")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Grabar
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
                    <Upload className="h-3.5 w-3.5" />
                    Subir archivo
                    <input type="file" accept="audio/*" className="hidden" onChange={handleFilePick} />
                  </label>
                </div>
              )}
            </div>

            {existing && existing.transcriptStatus === "ready" && (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Transcripción</p>
                  {!editingTranscript && (
                    <button type="button" onClick={() => setEditingTranscript(true)} className="text-xs text-primary hover:underline">
                      Corregir
                    </button>
                  )}
                </div>
                {editingTranscript ? (
                  <div className="mt-2">
                    <textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTranscript(false);
                          setTranscript(existing.transcript ?? "");
                        }}
                        className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={saveTranscript}
                        disabled={pending}
                        className="rounded-lg bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        Guardar corrección
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{existing.transcript}</p>
                )}
              </div>
            )}
          </>
        )}

        {error && (
          <div className="mt-3">
            <ActionError message={error} />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
