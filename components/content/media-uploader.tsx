"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";
import { attachMedia, removeMedia, requestMediaUpload } from "@/lib/actions/content-media";
import { RESUMABLE_THRESHOLD_BYTES, type MediaEntry } from "@/lib/content/media";

/**
 * Subir media de una pieza (F18).
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
export function MediaUploader({
  postId,
  media,
  canEdit,
}: {
  postId: string;
  media: MediaEntry[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
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

      if (ticket.data.resumable) {
        await uploadResumable(file, ticket.data.path, ticket.data.mime, setProgress);
      } else {
        await uploadSimple(file, ticket.data.path, ticket.data.token!, ticket.data.mime);
      }

      const attached = await attachMedia({
        postId,
        path: ticket.data.path,
        mime: ticket.data.mime,
        kind: kindOf(ticket.data.mime),
        sizeBytes: file.size,
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

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {media.map((item) => (
          <figure key={item.storage_path} className="w-32 rounded-lg border border-border p-2">
            <figcaption className="truncate text-[11px] text-muted-foreground" title={item.storage_path}>
              {item.kind} · {formatSize(item.size_bytes)}
            </figcaption>
            {canEdit && (
              <button
                type="button"
                onClick={async () => {
                  const result = await removeMedia({ postId, path: item.storage_path });
                  if (!result.ok) setError(result.error);
                  else router.refresh();
                }}
                className="mt-1 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                Quitar
              </button>
            )}
          </figure>
        ))}
      </div>

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
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              for (const file of files) await upload(file);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(busy)}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            {busy ? `Subiendo ${busy}${progress !== null ? ` (${progress}%)` : ""}` : "Subir media"}
          </button>
        </>
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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
