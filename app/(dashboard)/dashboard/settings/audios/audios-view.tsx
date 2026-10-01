"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Mic, Upload } from "lucide-react";
import {
  createAudioAsset,
  updateAudioAsset,
  deleteAudioAsset,
  correctAudioTranscript,
  requestAudioAssetUpload,
  type AudioUploadTicket,
} from "@/lib/actions/audio-library";
import { createClient } from "@/lib/supabase/client";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { headBase64Of } from "@/lib/content/media";
import { VoiceRecorder } from "@/components/inbox/voice-recorder";
import { formatRecordingDuration } from "@/lib/audio/recording";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionError, EmptyHint } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";

/**
 * Pantalla de la banca de audios (F20).
 *
 * Mismo esqueleto que templates-view.tsx (tabla + modal), con dos diferencias
 * de fondo: la descripcion es para la IA (hay que decirlo con esas palabras,
 * no es un comentario interno), y crear o reemplazar el archivo sube primero
 * a Storage y recien ahi llama a la accion de servidor — igual que el
 * composer (F18/F19), nunca al reves.
 */

export interface AudioRow {
  id: string;
  name: string;
  shortcut: string | null;
  description: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  transcript: string | null;
  transcriptStatus: "none" | "pending" | "ready" | "failed";
  agentEnabled: boolean;
  source: string;
}

function audioUrl(path: string): string {
  return `/api/v1/chat-media?path=${encodeURIComponent(path)}`;
}

function durationLabel(seconds: number | null): string {
  if (seconds == null) return "—";
  return formatRecordingDuration(seconds);
}

export function AudiosView({ audios, canManage }: { audios: AudioRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<AudioRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<AudioRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    start(async () => {
      const result = await deleteAudioAsset(target.id);
      setDeleting(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleAgentEnabled(audio: AudioRow) {
    if (audio.transcriptStatus !== "ready") return;
    start(async () => {
      const result = await updateAudioAsset(audio.id, {
        name: audio.name,
        description: audio.description,
        shortcut: audio.shortcut,
        agentEnabled: !audio.agentEnabled,
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
        route="/dashboard/settings/audios"
        backHref={
          <Link
            href="/dashboard/settings"
            aria-label="Volver a Ajustes"
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        right={
          canManage ? (
            <button
              onClick={() => { setError(null); setEditing("new"); }}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nuevo audio</span>
            </button>
          ) : null
        }
      />
      {error && <div className="px-4 pt-4 md:px-8"><ActionError message={error} /></div>}

      <div className="flex-1">
        {audios.length === 0 ? (
          <div className="px-8 py-12">
            <EmptyHint>
              Todavía no hay audios guardados.{" "}
              {canManage
                ? "Grabá o subí el primero: un saludo, el precio contado, cómo sigue el proceso. Se puede mandar desde la bandeja con \"/a\" o dejar que el agente lo use solo."
                : "Cuando un Owner o Admin grabe el primero, lo vas a poder mandar desde la bandeja con \"/a\"."}
            </EmptyHint>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-8 py-3 text-xs font-medium uppercase text-muted-foreground">Nombre</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Atajo</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Duración</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Audio</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Transcripción</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Asistente</th>
                {canManage && <th className="w-24 px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {audios.map((audio) => (
                <tr key={audio.id} className="border-b border-border align-top">
                  <td className="px-8 py-3 text-sm font-medium">{audio.name}</td>
                  <td className="px-4 py-3">
                    {audio.shortcut ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{audio.shortcut}</code>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                    {durationLabel(audio.durationSeconds)}
                  </td>
                  <td className="px-4 py-3">
                    <audio
                      controls
                      preload="none"
                      src={audioUrl(audio.storagePath)}
                      className="h-9 w-48 max-w-full dark:[color-scheme:dark]"
                    />
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    {audio.transcriptStatus === "ready" ? (
                      <span className="block truncate text-sm text-muted-foreground" title={audio.transcript ?? ""}>
                        {audio.transcript}
                      </span>
                    ) : audio.transcriptStatus === "failed" ? (
                      <span className="text-sm text-destructive">No se pudo transcribir</span>
                    ) : (
                      <span className="text-sm italic text-muted-foreground">Transcribiendo…</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleAgentEnabled(audio)}
                      disabled={!canManage || pending || audio.transcriptStatus !== "ready"}
                      title={
                        audio.transcriptStatus !== "ready"
                          ? "El agente solo puede usar un audio con la transcripción lista"
                          : audio.agentEnabled
                            ? "El agente lo puede mandar solo"
                            : "El agente no lo usa"
                      }
                      className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        audio.agentEnabled ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
                          audio.agentEnabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setError(null); setEditing(audio); }}
                          aria-label={`Editar ${audio.name}`}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleting(audio)}
                          aria-label={`Eliminar ${audio.name}`}
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
        <AudioDialog
          audio={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar audio"
        message={deleting ? `Se elimina "${deleting.name}". Deja de aparecer en la bandeja y el agente deja de usarlo.` : ""}
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
async function uploadAudio(file: Blob, declaredMime?: string): Promise<AudioUploadTicket> {
  const ticket = await requestAudioAssetUpload({
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

function AudioDialog({
  audio,
  onClose,
  onSaved,
}: {
  audio: AudioRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(audio?.name ?? "");
  const [description, setDescription] = useState(audio?.description ?? "");
  const [shortcut, setShortcut] = useState(audio?.shortcut ?? "");
  const [transcript, setTranscript] = useState(audio?.transcript ?? "");
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [mode, setMode] = useState<"record" | "upload" | null>(null);
  const [newFile, setNewFile] = useState<{ blob: Blob; mime: string; durationSeconds: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      try {
        let replacement: { storagePath: string; mimeType: string; durationSeconds?: number | null } | undefined;
        if (newFile) {
          const ticket = await uploadAudio(newFile.blob, newFile.mime);
          replacement = { storagePath: ticket.path, mimeType: ticket.mime, durationSeconds: newFile.durationSeconds };
        }

        if (audio) {
          const result = await updateAudioAsset(audio.id, {
            name, description, shortcut,
            ...(replacement ? { replacement } : {}),
          });
          if (!result.ok) { setError(result.error); return; }
        } else {
          if (!replacement) { setError("Grabá o subí un audio"); return; }
          const result = await createAudioAsset({
            name, description, shortcut,
            storagePath: replacement.storagePath,
            mimeType: replacement.mimeType,
            durationSeconds: replacement.durationSeconds,
            source: mode === "record" ? "recorded" : "uploaded",
          });
          if (!result.ok) { setError(result.error); return; }
        }

        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Algo salió mal");
      }
    });
  }

  function saveTranscript() {
    if (!audio) return;
    setError(null);
    start(async () => {
      const result = await correctAudioTranscript(audio.id, transcript);
      if (!result.ok) { setError(result.error); return; }
      setEditingTranscript(false);
    });
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewFile({ blob: file, mime: file.type || "application/octet-stream", durationSeconds: null });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">{audio ? "Editar audio" : "Nuevo audio"}</h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="audio-name" className="mb-1 block text-xs font-medium text-muted-foreground">
              Nombre
            </label>
            <input
              id="audio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Precio del servicio"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="audio-shortcut" className="mb-1 block text-xs font-medium text-muted-foreground">
              Atajo (opcional)
            </label>
            <input
              id="audio-shortcut"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="/precio"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="audio-description" className="mb-1 block text-xs font-medium text-muted-foreground">
            Descripción (para la IA)
          </label>
          <textarea
            id="audio-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Cuándo preguntan cuánto cuesta el servicio"
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground/70">
            No es para la persona que lo escucha: es lo que el agente lee para decidir cuándo mandar este audio solo.
          </p>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {audio ? "Reemplazar archivo (opcional)" : "Archivo"}
          </p>

          {audio && !mode && !newFile && (
            <audio controls preload="none" src={audioUrl(audio.storagePath)} className="mb-2 h-9 w-full dark:[color-scheme:dark]" />
          )}

          {newFile ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <audio controls autoPlay={false} src={URL.createObjectURL(newFile.blob)} className="h-9 flex-1 dark:[color-scheme:dark]" />
              <button
                type="button"
                onClick={() => { setNewFile(null); setMode(null); }}
                className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
              >
                Descartar
              </button>
            </div>
          ) : mode === "record" ? (
            <VoiceRecorder
              onSend={(file, mime, durationSeconds) => { setNewFile({ blob: file, mime, durationSeconds }); setMode(null); }}
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

        {audio && audio.transcriptStatus === "ready" && (
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
                    onClick={() => { setEditingTranscript(false); setTranscript(audio.transcript ?? ""); }}
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
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{audio.transcript}</p>
            )}
          </div>
        )}

        {error && <div className="mt-3"><ActionError message={error} /></div>}

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
