"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FileText, Loader2, Pencil, Play } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { formatDateOnly } from "@/lib/dates";
import { getAdVideo, saveAdTranscript } from "@/lib/actions/ad-video";
import { MAX_TRANSCRIPT_CHARS, type AdMedia } from "@/lib/meta/ad-transcript";

/**
 * «Video y transcripción» en el detalle de un anuncio (00323).
 *
 * - El video se pide a Meta recién al apretar «Ver video» (el link vence en unas horas: no se guarda).
 * - La transcripción, por ahora, se escribe a mano. Vacía y guardada, se borra.
 * - Si el anuncio está vinculado a una pieza con guion, se muestra el guion: es lo que se planeó decir.
 *
 * Las acciones del servidor vuelven a comprobar los permisos: esto solo decide qué botones dibujar.
 */
export function AdMediaCard({ adId, media, piece }: { adId: string; media: AdMedia; piece: { id: string; title: string } | null }) {
  const timeZone = useViewerTimezone();
  const router = useRouter();

  const [video, setVideo] = useState<{ url: string; origin: "ad_video" | "instagram" } | null>(null);
  const [videoState, setVideoState] = useState<"idle" | "loading" | "error">("idle");
  const [videoError, setVideoError] = useState<string | null>(null);

  const [transcript, setTranscript] = useState(media.transcript);
  const [updatedAt, setUpdatedAt] = useState(media.transcriptUpdatedAt);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadVideo() {
    setVideoState("loading");
    setVideoError(null);
    const res = await getAdVideo({ adId });
    if (res.ok) {
      setVideo({ url: res.url, origin: res.origin });
      setVideoState("idle");
    } else {
      setVideoError(res.error);
      setVideoState("error");
    }
  }

  function startEditing() {
    setDraft(transcript ?? "");
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await saveAdTranscript({ adId, transcript: draft });
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      return;
    }
    setTranscript(res.transcript);
    if (res.updatedAt !== null || res.transcript === null) setUpdatedAt(res.updatedAt);
    setEditing(false);
    router.refresh();
  }

  async function copy() {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso para el portapapeles: no pasa nada, el texto se puede seleccionar a mano.
    }
  }

  const tooLong = draft.length > MAX_TRANSCRIPT_CHARS;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="Video y transcripción">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Video y transcripción</h3>
        {media.videoKind && !video && (
          <button
            type="button"
            onClick={loadVideo}
            disabled={videoState === "loading"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
          >
            {videoState === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {media.videoKind === "video" ? "Ver video" : "Buscar el video de la publicación"}
          </button>
        )}
      </div>

      {videoError && <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-foreground">{videoError}</p>}

      {video && (
        <div className="space-y-1.5">
          <video src={video.url} controls preload="metadata" className="max-h-[28rem] w-full max-w-sm rounded-lg bg-black" />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <a href={video.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-ink hover:underline">
              <ExternalLink className="h-3 w-3" aria-hidden />
              Abrir el archivo
            </a>
            <span>
              {video.origin === "instagram" ? "Es el video de la publicación de Instagram. " : ""}
              El link vence en unas horas: para bajarlo, abrilo y guardalo.
            </span>
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Transcripción</p>
          {!editing && (
            <div className="flex items-center gap-1">
              {transcript && (
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied ? "Copiada" : "Copiar"}
                </button>
              )}
              {media.canEditTranscript && (
                <button
                  type="button"
                  onClick={startEditing}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary-ink hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {transcript ? "Editar" : "Escribir"}
                </button>
              )}
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              autoFocus
              aria-label="Transcripción del video"
              placeholder="Pegá o escribí lo que se dice en el video."
              className="w-full resize-y rounded-lg border border-input bg-background p-2 text-sm text-foreground"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
                {draft.length.toLocaleString("es")} / {MAX_TRANSCRIPT_CHARS.toLocaleString("es")} caracteres
                {draft.trim() === "" && transcript ? " · guardar vacía la borra" : ""}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || tooLong}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Guardar
                </button>
              </div>
            </div>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          </div>
        ) : transcript ? (
          <div>
            <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">{transcript}</p>
            {updatedAt && <p className="mt-1 text-xs text-muted-foreground">Cargada a mano el {formatDateOnly(updatedAt, timeZone)}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Todavía no hay transcripción.
            {media.canEditTranscript ? " Podés escribirla o pegarla con «Escribir»." : ""}
          </p>
        )}
      </div>

      {media.pieceScript && piece && (
        <details className="rounded-lg border border-border p-2">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Guion de la pieza «{piece.title}»
          </summary>
          <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">{media.pieceScript}</p>
          <Link href={`/dashboard/content?piece=${piece.id}`} className="mt-2 inline-block text-xs font-medium text-primary-ink hover:underline">
            Abrir la pieza
          </Link>
        </details>
      )}
    </section>
  );
}
