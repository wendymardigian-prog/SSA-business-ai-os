"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Loader2, Mic, Upload, X } from "lucide-react";
import {
  createAsset,
  updateAsset,
  correctTranscript,
  retryTranscription,
  requestAssetUpload,
  requestAssetPreviewUpload,
  type AssetFileInput,
} from "@/lib/actions/response-assets";
import {
  ASSET_KINDS,
  ASSET_KIND_HINT,
  ASSET_KIND_LABEL,
  LINK_KINDS,
  LINK_KIND_LABEL,
  acceptsCaption,
  hasFile,
  isTranscribableKind,
  type AssetKind,
} from "@/lib/response-assets/kind";
import {
  KIND_SHAPE,
  isRequired,
  normalizeShortcut,
  parseTagInput,
  validateAssetFields,
  type AssetField,
} from "@/lib/response-assets/shape";
import { ACCEPT_ATTRIBUTE, ACCEPTED_FORMATS_LABEL, MAX_ASSET_BYTES, formatBytes, isFileAssetKind } from "@/lib/response-assets/files";
import { assetAttachment } from "@/lib/response-assets/preview";
import { probeMedia } from "@/lib/response-assets/media-probe";
import type { BankAsset } from "@/lib/response-assets/list";
import { TEMPLATE_VARIABLES, PREVIEW_CONTEXT, interpolateTemplate } from "@/lib/templates/interpolate";
import { createClient } from "@/lib/supabase/client";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { headBase64Of } from "@/lib/content/media";
import { VoiceRecorder } from "@/components/inbox/voice-recorder";
import { MediaAttachment } from "@/components/inbox/media-attachment";
import { ActionError } from "@/components/contacts/ui";
import { cn } from "@/lib/utils";
import { AssetKindIcon } from "./asset-kind-icon";
import { TranscriptBlock } from "./asset-preview";

/**
 * Alta y edicion de un recurso de la banca (F6).
 *
 * "Nuevo recurso" pregunta PRIMERO el tipo (seis tarjetas) y el formulario
 * cambia segun la respuesta: que campos se muestran y cuales son obligatorios
 * sale de `KIND_SHAPE` (lib/response-assets/shape.ts), la misma tabla que usa
 * el servidor. Al editar, el tipo queda fijo: convertir un texto en audio no
 * es editar, es crear otra cosa.
 *
 * El archivo se sube ANTES de guardar, con un ticket firmado que el servidor
 * da despues de mirar los primeros bytes (nunca la extension).
 */

interface PickedFile {
  blob: Blob;
  name: string;
  declaredMime: string;
  durationSeconds: number | null;
  source: "recorded" | "uploaded";
  thumbnail: Blob | null;
  objectUrl: string;
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function AssetFormDialog({
  asset,
  initialKind = null,
  assets,
  workspaceName,
  onClose,
  onSaved,
}: {
  /** null = alta. */
  asset: BankAsset | null;
  /** Para el alta directa desde el estado vacio: salta las tarjetas. */
  initialKind?: AssetKind | null;
  /** Toda la banca: para avisar un atajo repetido antes de guardar. */
  assets: BankAsset[];
  workspaceName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = asset;
  const [kind, setKind] = useState<AssetKind | null>(existing?.kind ?? initialKind);

  const [name, setName] = useState(existing?.name ?? "");
  const [shortcut, setShortcut] = useState(existing?.shortcut ?? "");
  const [tagsText, setTagsText] = useState((existing?.tags ?? []).join(", "));
  const [description, setDescription] = useState(existing?.description ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [linkKind, setLinkKind] = useState<string>(existing?.linkKind ?? "");
  const [caption, setCaption] = useState(existing?.caption ?? "");
  const [hasVoice, setHasVoice] = useState(true);

  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [probing, setProbing] = useState(false);
  const [recording, setRecording] = useState(false);

  const [transcript, setTranscript] = useState(existing?.transcript ?? "");
  const [editingTranscript, setEditingTranscript] = useState(false);
  // La transcripcion escrita a mano al CREAR o al reemplazar el archivo. Va
  // aparte de `transcript` (la de un recurso ya guardado): al reemplazar, la
  // vieja ya no corresponde al archivo nuevo.
  const [draftTranscript, setDraftTranscript] = useState("");

  const [fieldError, setFieldError] = useState<{ field: AssetField; error: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  useEffect(() => {
    if (kind) firstField.current?.focus();
  }, [kind]);

  // Libera la URL local del archivo elegido cuando se descarta, se cambia o se
  // cierra. Depende SOLO de la URL: sumarle la miniatura al mismo archivo no
  // tiene que liberar la que se esta mostrando.
  const pickedUrl = picked?.objectUrl ?? null;
  useEffect(() => () => {
    if (pickedUrl) URL.revokeObjectURL(pickedUrl);
  }, [pickedUrl]);

  /** El atajo repetido se avisa mientras se escribe, con quien choca y de que tipo es. */
  const shortcutClash = useMemo(() => {
    const normalized = normalizeShortcut(shortcut);
    if (!normalized) return null;
    return assets.find((a) => a.shortcut === normalized && a.id !== existing?.id) ?? null;
  }, [shortcut, assets, existing?.id]);

  if (!kind) {
    return (
      <Shell title="Nuevo recurso" onClose={onClose}>
        <p className="mt-1 text-sm text-muted-foreground">¿Qué querés guardar?</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {ASSET_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                <AssetKindIcon kind={k} className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">{ASSET_KIND_LABEL[k]}</span>
                <span className="block text-xs text-muted-foreground">{ASSET_KIND_HINT[k]}</span>
              </span>
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  const shape = KIND_SHAPE[kind];
  const allowed = (field: AssetField) => shape.allowed.includes(field);
  const preview = interpolateTemplate(content, { ...PREVIEW_CONTEXT, workspace: { name: workspaceName } });
  const existingAttachment = existing ? assetAttachment(existing) : null;

  async function pickFile(file: File | Blob, opts: { name: string; declaredMime: string; source: "recorded" | "uploaded"; durationSeconds?: number | null }) {
    setError(null);
    setFieldError(null);
    if (file.size > MAX_ASSET_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      setFieldError({ field: "file", error: `El archivo pesa ${mb} MB y el máximo es 16 MB` });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const base: PickedFile = {
      blob: file,
      name: opts.name,
      declaredMime: opts.declaredMime,
      durationSeconds: opts.durationSeconds ?? null,
      source: opts.source,
      thumbnail: null,
      objectUrl,
    };
    setPicked(base);

    if (kind === "video" || (kind === "audio" && opts.durationSeconds == null)) {
      setProbing(true);
      const probe = await probeMedia(file, kind === "video" ? "video" : "audio");
      setProbing(false);
      setPicked((current) =>
        current && current.objectUrl === objectUrl
          ? { ...current, durationSeconds: current.durationSeconds ?? probe.durationSeconds, thumbnail: probe.thumbnail }
          : current,
      );
    }
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void pickFile(file, { name: file.name, declaredMime: file.type || "application/octet-stream", source: "uploaded" });
  }

  async function uploadPicked(file: PickedFile): Promise<AssetFileInput> {
    if (!kind || !isFileAssetKind(kind)) throw new Error("Este tipo de recurso no lleva archivo");
    const supabase = createClient();

    const ticket = await requestAssetUpload({
      kind,
      sizeBytes: file.blob.size,
      headBase64: await headBase64Of(file.blob),
      declaredMime: file.declaredMime,
    });
    if (!ticket.ok) throw new Error(ticket.error);
    const { error: uploadError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .uploadToSignedUrl(ticket.ticket.path, ticket.ticket.token, file.blob, { contentType: ticket.ticket.mime });
    if (uploadError) throw new Error("No se pudo subir el archivo. Probá de nuevo.");

    // La miniatura es una comodidad: si falla, el alta sigue con el icono.
    let previewPath: string | null = null;
    if (kind === "video" && file.thumbnail) {
      try {
        const previewTicket = await requestAssetPreviewUpload({
          sizeBytes: file.thumbnail.size,
          headBase64: await headBase64Of(file.thumbnail),
        });
        if (previewTicket.ok) {
          const { error: previewError } = await supabase.storage
            .from(CHAT_MEDIA_BUCKET)
            .uploadToSignedUrl(previewTicket.ticket.path, previewTicket.ticket.token, file.thumbnail, { contentType: "image/jpeg" });
          if (!previewError) previewPath = previewTicket.ticket.path;
        }
      } catch (err) {
        console.warn("[recursos] no se pudo subir la miniatura:", err instanceof Error ? err.message : err);
      }
    }

    return {
      storagePath: ticket.ticket.path,
      mimeType: ticket.ticket.mime,
      sizeBytes: file.blob.size,
      durationSeconds: file.durationSeconds,
      source: file.source,
      previewPath,
    };
  }

  function submit() {
    if (!kind) return;
    setError(null);
    setFieldError(null);

    const fields = {
      name,
      shortcut,
      description,
      tags: parseTagInput(tagsText),
      content,
      url,
      linkKind,
      caption,
      // Para validar alcanza con saber que HAY archivo: se sube despues.
      storagePath: picked ? "pendiente" : (existing?.storagePath ?? null),
    };
    const check = validateAssetFields(kind, fields);
    if (!check.ok) {
      setFieldError({ field: check.field, error: check.error });
      return;
    }
    if (shortcutClash) {
      setFieldError({
        field: "shortcut",
        error: `Ese atajo ya lo usa "${shortcutClash.name}" (${ASSET_KIND_LABEL[shortcutClash.kind].toLowerCase()}).`,
      });
      return;
    }

    start(async () => {
      try {
        const file = picked && hasFile(kind) ? await uploadPicked(picked) : null;
        const common = { name, shortcut, description, tags: fields.tags, content, url, linkKind, caption };

        const result = existing
          ? await updateAsset(existing.id, {
              ...common,
              replacement: file ? { ...file, hasVoice, transcript: draftTranscript } : null,
            })
          : await createAsset({ kind, ...common, file, hasVoice, transcript: draftTranscript });

        if (!result.ok) {
          setError(result.error);
          return;
        }
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Algo salió mal. Probá de nuevo.");
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
      setNotice("Transcripción corregida. Ningún reintento automático la va a pisar.");
    });
  }

  function retry() {
    if (!existing) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await retryTranscription(existing.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(TRANSCRIBE_OUTCOME_NOTICE[result.outcome]);
    });
  }

  const errorFor = (field: AssetField) => (fieldError?.field === field ? fieldError.error : null);
  const title = existing ? `Editar ${ASSET_KIND_LABEL[kind].toLowerCase()}` : `Nuevo ${ASSET_KIND_LABEL[kind].toLowerCase()}`;

  return (
    <Shell title={title} kind={kind} onClose={onClose} onBack={!existing && !initialKind ? () => setKind(null) : undefined}>
      {/* Archivo primero: es lo que mas cuesta y lo que define el resto. */}
      {isFileAssetKind(kind) && (
        <Field label={existing ? "Archivo" : "Archivo"} required={!existing} error={errorFor("file")}>
          {existingAttachment && !picked && (
            <div className="mb-2 text-foreground">
              <MediaAttachment item={existingAttachment} />
            </div>
          )}

          {picked ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2">
              <LocalPreview kind={kind} file={picked} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {picked.name} · {formatBytes(picked.blob.size)}
                  {probing && " · leyendo el archivo…"}
                  {!probing && kind === "video" && !picked.thumbnail && " · sin miniatura (se va a ver el ícono)"}
                </span>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="rounded-lg border border-border px-2 py-1 hover:bg-accent"
                >
                  Descartar
                </button>
              </div>
            </div>
          ) : recording ? (
            <VoiceRecorder
              onSend={(file, mime, durationSeconds) => {
                setRecording(false);
                void pickFile(file, { name: "grabación", declaredMime: mime, source: "recorded", durationSeconds });
              }}
              onCancel={() => setRecording(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {kind === "audio" && (
                <button
                  type="button"
                  onClick={() => setRecording(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  <Mic className="h-3.5 w-3.5" aria-hidden />
                  Grabar
                </button>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
                <Upload className="h-3.5 w-3.5" aria-hidden />
                {existing ? "Reemplazar archivo" : "Subir archivo"}
                <input type="file" accept={ACCEPT_ATTRIBUTE[kind]} className="sr-only" onChange={handleFileInput} />
              </label>
              <span className="self-center text-xs text-muted-foreground">
                {ACCEPTED_FORMATS_LABEL[kind]}, hasta 16 MB
              </span>
            </div>
          )}

          {kind === "video" && (!existing || picked) && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!hasVoice} onChange={(e) => setHasVoice(!e.target.checked)} className="h-4 w-4" />
              Este video no tiene voz
              <span className="text-xs text-muted-foreground">(no se transcribe ni se cobra)</span>
            </label>
          )}
        </Field>
      )}

      {kind === "link" && (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Dirección" htmlFor="asset-url" required error={errorFor("url")}>
            <input
              id="asset-url"
              ref={firstField}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendly.com/tu-agenda"
              inputMode="url"
              className={inputClass}
            />
          </Field>
          <Field label="Qué es" htmlFor="asset-link-kind" required error={errorFor("linkKind")}>
            <select id="asset-link-kind" value={linkKind} onChange={(e) => setLinkKind(e.target.value)} className={inputClass}>
              <option value="">Elegí…</option>
              {LINK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LINK_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Nombre" htmlFor="asset-name" required error={errorFor("name")}>
          <input
            id="asset-name"
            ref={kind === "link" ? undefined : firstField}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={NAME_PLACEHOLDER[kind]}
            className={inputClass}
          />
        </Field>
        <Field label="Atajo" htmlFor="asset-shortcut" error={errorFor("shortcut")}>
          <input
            id="asset-shortcut"
            value={shortcut ?? ""}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="/precio"
            aria-describedby="asset-shortcut-clash"
            className={inputClass}
          />
          {shortcutClash && fieldError?.field !== "shortcut" && (
            <p id="asset-shortcut-clash" className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Ya lo usa &ldquo;{shortcutClash.name}&rdquo; ({ASSET_KIND_LABEL[shortcutClash.kind].toLowerCase()}).
            </p>
          )}
        </Field>
      </div>

      {kind === "text" && (
        <>
          <Field label="Texto" htmlFor="asset-content" required error={errorFor("content")}>
            <textarea
              id="asset-content"
              value={content ?? ""}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="Hola {{contact.display_name}}, gracias por escribir a {{workspace.name}}."
              className={cn(inputClass, "resize-y")}
            />
          </Field>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
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
            <p className="mt-2 text-xs text-muted-foreground/70">Si el contacto no tiene ese dato cargado, la variable queda vacía.</p>
          </div>
          {content.trim() && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Así se ve con datos de ejemplo</p>
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm">{preview}</p>
            </div>
          )}
        </>
      )}

      <Field
        label="Descripción"
        htmlFor="asset-description"
        required={isRequired(kind, "description")}
        error={errorFor("description")}
        hint="Para encontrarlo y para que el asistente sepa cuándo usarlo. No la ve el contacto."
      >
        <textarea
          id="asset-description"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder={DESCRIPTION_PLACEHOLDER[kind]}
          className={cn(inputClass, "resize-y")}
        />
      </Field>

      {acceptsCaption(kind) && allowed("caption") && (
        <Field
          label="Texto que lo acompaña"
          htmlFor="asset-caption"
          error={errorFor("caption")}
          hint="Lo que ve el contacto junto al archivo. Se puede cambiar antes de cada envío."
        >
          <textarea
            id="asset-caption"
            value={caption ?? ""}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            placeholder="Te paso esto que te va a servir"
            className={cn(inputClass, "resize-y")}
          />
        </Field>
      )}

      <Field label="Etiquetas" htmlFor="asset-tags" error={errorFor("tags")} hint="Separadas por coma. Sirven para filtrar en la bandeja.">
        <input
          id="asset-tags"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="precios, objeciones, testimonios"
          className={inputClass}
        />
      </Field>

      {/* Al crear (o al reemplazar el archivo): se puede escribir la transcripcion. Vacia, se transcribe sola al guardar. */}
      {isTranscribableKind(kind) && (!existing || picked) && (kind === "audio" || hasVoice) && (
        <Field
          label="Transcripción"
          htmlFor="asset-draft-transcript"
          hint="Si la dejás vacía, se transcribe sola con IA apenas guardás (tarda unos segundos; guardar no espera). Si la escribís vos, queda lista al instante y no se usa IA. El asistente solo puede usar este recurso cuando la transcripción está lista."
        >
          <textarea
            id="asset-draft-transcript"
            value={draftTranscript}
            onChange={(e) => setDraftTranscript(e.target.value)}
            rows={3}
            placeholder="Lo que se dice en el audio, tal cual"
            className={cn(inputClass, "resize-y")}
          />
        </Field>
      )}

      {existing && isTranscribableKind(kind) && !picked && (
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Transcripción</p>
            {!editingTranscript && existing.transcriptStatus !== "pending" && (
              <button type="button" onClick={() => setEditingTranscript(true)} className="text-xs font-medium text-primary hover:underline">
                {existing.transcriptStatus === "ready" ? "Corregir" : "Escribirla a mano"}
              </button>
            )}
          </div>
          {editingTranscript ? (
            <div>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={4}
                aria-label="Transcripción"
                className={cn(inputClass, "resize-y")}
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
            <TranscriptBlock asset={existing} onRetry={retry} retrying={pending} />
          )}
        </div>
      )}

      {notice && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
      {error && <ActionError message={error} />}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || probing}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Guardar
        </button>
      </div>
    </Shell>
  );
}

/** Lo que se le dice a la persona despues de "Transcribir con IA", segun como terminó. */
const TRANSCRIBE_OUTCOME_NOTICE = {
  done: "Listo: la transcripción está lista.",
  queued: "El servicio de transcripción no respondió. Se reintenta solo en unos minutos.",
  failed: "No se pudo transcribir. El motivo está más arriba; podés escribirla a mano.",
  skipped: "Ya la estaba tomando otro proceso. Se actualiza en unos segundos.",
} as const;

const NAME_PLACEHOLDER: Record<AssetKind, string> = {
  text: "Precio del servicio",
  audio: "Audio de bienvenida",
  video: "Testimonio de Ana",
  image: "Captura de resultados",
  file: "Propuesta comercial",
  link: "Agenda para llamada",
};

const DESCRIPTION_PLACEHOLDER: Record<AssetKind, string> = {
  text: "Cuándo preguntan cuánto cuesta el servicio",
  audio: "Cuando alguien escribe por primera vez y quiere saber cómo trabajamos",
  video: "Clienta de estética que triplicó sus consultas en dos meses",
  image: "Captura del panel con los resultados de un cliente",
  file: "PDF con los tres planes y sus precios",
  link: "Para que reserven la llamada de diagnóstico",
};

/** Vista local del archivo elegido, antes de subirlo (no pasa por el servidor). */
function LocalPreview({ kind, file }: { kind: AssetKind; file: PickedFile }) {
  if (kind === "audio") return <audio controls src={file.objectUrl} className="h-10 w-full dark:[color-scheme:dark]" />;
  if (kind === "video")
    return <video controls playsInline src={file.objectUrl} className="max-h-60 w-full rounded-lg bg-black dark:[color-scheme:dark]" />;
  if (kind === "image")
    // eslint-disable-next-line @next/next/no-img-element -- es un blob local del navegador, no hay nada que optimizar.
    return <img src={file.objectUrl} alt="Vista previa" className="max-h-60 w-auto max-w-full rounded-lg object-contain" />;
  return null;
}

function Field({
  label,
  htmlFor,
  required = false,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-red-600 dark:text-red-400"> *</span> : <span className="font-normal"> (opcional)</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted-foreground/80">{hint}</p>
      )}
    </div>
  );
}

function Shell({
  title,
  kind,
  onClose,
  onBack,
  children,
}: {
  title: string;
  kind?: AssetKind;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-dialog-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-5 shadow-lg"
      >
        <div className="flex items-center gap-2">
          {kind && (
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
              <AssetKindIcon kind={kind} className="h-3.5 w-3.5" />
            </span>
          )}
          <h2 id="asset-dialog-title" className="flex-1 text-base font-semibold">
            {title}
          </h2>
          {onBack && (
            <button type="button" onClick={onBack} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
              Cambiar tipo
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
