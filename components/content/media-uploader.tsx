"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";
import { attachMedia, removeMedia, requestMediaUpload } from "@/lib/actions/content-media";
import { RESUMABLE_THRESHOLD_BYTES, liveMedia, type MediaEntry } from "@/lib/content/media";
import { describeFile, idOf } from "@/lib/content/media-library";
import { probeMediaFile } from "@/lib/content/media-probe";
import { cn } from "@/lib/utils";

/**
 * La biblioteca de archivos de una pieza (F92) y la subida (F18).
 *
 * Cada archivo se sube UNA vez y se muestra con su nombre, tipo, peso y
 * proporcion, y con **que redes lo usan** (o "Sin usar", en naranja). Cada red
 * elige despues cuales publica; aca solo se sube y se saca.
 *
 * Quitar un archivo que alguna red usa avisa antes y lo saca tambien de esas
 * redes: el servidor lo hace siempre, esto solo se lo dice a la persona.
 *
 * El archivo va DIRECTO del navegador a Storage. El servidor solo mira los
 * primeros bytes, decide si se puede y devuelve a donde: un video de 1 GB no
 * entra en una Server Action.
 *
 * Dos caminos segun el tamaño:
 *   - Chico (≤ 6 MB): una subida simple con URL firmada.
 *   - Grande: TUS, que sube por partes y retoma si se corta. Un video de 800
 *     MB por una conexion de casa NO termina de una sola vez.
 *
 * `tus-js-client` se carga solo cuando hace falta (import dinamico): la
 * mayoria de las subidas son imagenes y no tienen por que pagar ese peso.
 */

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
};

export function MediaUploader({
  postId,
  media,
  usage,
  canEdit,
  onRemoved,
}: {
  postId: string;
  media: MediaEntry[];
  /** id de archivo -> redes que lo usan. Sin entrada = sin usar. */
  usage: Record<string, string[]>;
  canEdit: boolean;
  /** Se llama al quitar uno, con las redes de las que se saco tambien. */
  onRemoved?: (fileId: string, removedFrom: string[]) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const files = liveMedia(media);

  async function upload(file: File) {
    setError(null);
    setNotice(null);
    setBusy(file.name);
    setProgress(null);

    try {
      // Los primeros bytes, que es con lo que el servidor decide el tipo.
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const ticket = await requestMediaUpload({
        postId,
        fileName: file.name,
        sizeBytes: file.size,
        headBase64: btoa(String.fromCharCode(...head)),
        declaredMime: file.type || undefined,
      });

      if (!ticket.ok) {
        setError(ticket.error);
        return;
      }

      // Mientras se sube se leen las dimensiones y la duracion: es lo que
      // permite mostrar la proporcion y avisar de un Reel demasiado largo.
      const [probed] = await Promise.all([
        probeMediaFile(file, ticket.data.mime),
        ticket.data.resumable
          ? uploadResumable(file, ticket.data.path, ticket.data.mime, setProgress)
          : uploadSimple(file, ticket.data.path, ticket.data.token!, ticket.data.mime),
      ]);

      const attached = await attachMedia({
        postId,
        path: ticket.data.path,
        mime: ticket.data.mime,
        kind: kindOf(ticket.data.mime),
        sizeBytes: file.size,
        name: file.name,
        width: probed.width,
        height: probed.height,
        durationMs: probed.durationMs,
      });

      if (!attached.ok) {
        setError(attached.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude subir el archivo");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function remove(item: MediaEntry, label: string) {
    const id = idOf(item);
    const usedBy = usage[id] ?? [];

    // Avisar antes: sacarlo de la biblioteca lo saca de esas redes tambien.
    const names = usedBy.map((p) => PLATFORM_NAMES[p] ?? p).join(" y ");
    const message =
      usedBy.length > 0
        ? `"${label}" lo usa ${names}. Si lo quitás, también se saca de ahí. ¿Seguís?`
        : `¿Quitar "${label}" de la pieza?`;
    if (!window.confirm(message)) return;

    setError(null);
    setNotice(null);
    const result = await removeMedia({ postId, fileId: id });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRemoved?.(id, result.data.removedFrom);
    if (result.data.removedFrom.length > 0) {
      setNotice(
        `Se quitó también de ${result.data.removedFrom.map((p) => PLATFORM_NAMES[p] ?? p).join(" y ")}.`,
      );
    }
    router.refresh();
  }

  return (
    <div>
      {files.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
          Todavía no hay archivos. Subilos una vez y después elegís cuáles publica cada red.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Archivos de la pieza">
          {files.map((item, index) => {
            const info = describeFile(item, index);
            const usedBy = usage[idOf(item)] ?? [];
            return (
              <li key={idOf(item)} className="rounded-lg border border-border p-3">
                <p className="truncate text-sm font-medium" title={info.name}>
                  {info.name}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {[info.kindLabel, info.size, info.ratio].filter(Boolean).join(" · ")}
                </p>

                <p
                  className={cn(
                    "mt-1.5 inline-block rounded px-1.5 py-0.5 text-[11px]",
                    usedBy.length === 0
                      ? "bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {usedBy.length === 0
                    ? "Sin usar"
                    : `Se usa en ${usedBy.map((p) => PLATFORM_NAMES[p] ?? p).join(", ")}`}
                </p>

                {canEdit && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => void remove(item, info.name)}
                      className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      Quitar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.pdf"
            multiple
            className="sr-only"
            aria-label="Elegir archivos para subir"
            onChange={async (e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = "";
              for (const file of picked) await upload(file);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(busy)}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            {busy ? `Subiendo ${busy}${progress !== null ? ` (${progress}%)` : ""}` : "Subir archivos"}
          </button>
        </>
      )}

      {notice && (
        <p role="status" className="mt-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function kindOf(mime: string): MediaEntry["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** Subida simple, con la URL firmada que dio el servidor. */
async function uploadSimple(file: File, path: string, token: string, mime: string) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { error } = await supabase.storage
    .from("content-media")
    .uploadToSignedUrl(path, token, file, { contentType: mime });
  if (error) throw new Error(error.message);
}

/**
 * Subida por partes con TUS.
 *
 * Usa el token de la sesion: la policy del bucket decide si esa persona puede
 * escribir en esa carpeta (migracion 00083). El tamaño de parte de 6 MB es el
 * que pide Supabase.
 */
async function uploadResumable(
  file: File,
  path: string,
  mime: string,
  onProgress: (percent: number) => void,
) {
  const [{ Upload }, { createClient }] = await Promise.all([
    import("tus-js-client"),
    import("@/lib/supabase/client"),
  ]);

  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Se cerro la sesion: volve a entrar y proba de nuevo");

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${projectUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "content-media",
        objectName: path,
        contentType: mime,
      },
      chunkSize: RESUMABLE_THRESHOLD_BYTES,
      onError: (err) => reject(err),
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });

    // Si quedo una subida a medias del mismo archivo, se retoma en vez de
    // empezar de cero: es todo el sentido de TUS.
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    });
  });
}
