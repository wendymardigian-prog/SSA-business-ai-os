"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { MediaAttachment } from "@/components/inbox/media-attachment";
import { assetAttachment, assetOpenUrl } from "@/lib/response-assets/preview";
import { transcriptStatusLabel, type BankAsset } from "@/lib/response-assets/list";
import { LINK_KIND_LABEL, isTranscribableKind } from "@/lib/response-assets/kind";
import { formatLabel, formatBytes } from "@/lib/response-assets/files";
import { urlDomain } from "@/lib/response-assets/shape";
import { cn } from "@/lib/utils";

/**
 * Revisar un recurso antes de mandarlo (F9): lo usan la pantalla de gestion
 * (al tocar "Ver") y el widget del chat (antes de Enviar).
 *
 * **No hay visor propio.** El archivo lo dibuja `MediaAttachment`, el mismo
 * componente de la burbuja de la bandeja: el audio y el video arrancan como
 * una tarjeta con ▶ y recien al apretarla se firma la URL; la imagen carga
 * lazy; un documento se abre o se baja. Lo que se suma aca es lo que la
 * burbuja no tiene: la descripcion, la transcripcion entera y el "Abrir".
 */
export function AssetPreview({
  asset,
  onRetryTranscript,
  retrying = false,
  children,
  className,
}: {
  asset: BankAsset;
  /** Reintentar una transcripcion fallida. Sin esto, no se ofrece. */
  onRetryTranscript?: () => void;
  retrying?: boolean;
  /** Lo que el que lo usa agrega abajo (el caption editable del widget). */
  children?: ReactNode;
  className?: string;
}) {
  const attachment = assetAttachment(asset);
  const openUrl = assetOpenUrl(asset);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2 text-sm", className)}>
      {asset.kind === "text" && (
        <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-3 py-2">{asset.content}</p>
      )}

      {asset.kind === "link" && asset.url && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{urlDomain(asset.url)}</span>
            <span className="block truncate text-xs text-muted-foreground">{asset.url}</span>
          </span>
          {asset.linkKind && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{LINK_KIND_LABEL[asset.linkKind]}</span>
          )}
          <OpenButton href={asset.url} label="Abrir en pestaña nueva" />
        </div>
      )}

      {attachment && (
        <div className="min-w-0 text-foreground">
          <MediaAttachment item={attachment} />
          {(asset.kind === "image" || asset.kind === "file") && openUrl && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <OpenButton href={openUrl} label={asset.kind === "image" ? "Ver en grande" : "Abrir"} />
              {asset.kind === "file" && (
                <span className="text-xs text-muted-foreground">
                  {[formatLabel(asset.mimeType), formatBytes(asset.sizeBytes)].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {asset.description && asset.kind !== "text" && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Para qué sirve: </span>
          {asset.description}
        </p>
      )}

      {isTranscribableKind(asset.kind) && (
        <TranscriptBlock asset={asset} onRetry={onRetryTranscript} retrying={retrying} />
      )}

      {children}
    </div>
  );
}

function OpenButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      {label}
    </a>
  );
}

/**
 * La transcripcion completa, recortada a unas lineas con "Ver todo". Si
 * fallo, el motivo y Reintentar; si todavia no esta, su estado.
 */
export function TranscriptBlock({
  asset,
  onRetry,
  retrying = false,
}: {
  asset: Pick<BankAsset, "kind" | "transcript" | "transcriptStatus" | "transcriptError">;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (asset.transcriptStatus === "ready" && asset.transcript) {
    const long = asset.transcript.length > 220;
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Transcripción</p>
        <p className={cn("whitespace-pre-wrap text-sm", !expanded && long && "line-clamp-3")}>{asset.transcript}</p>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {expanded ? "Ver menos" : "Ver todo"}
          </button>
        )}
      </div>
    );
  }

  if (asset.transcriptStatus === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
        <span className="min-w-0 flex-1">
          <span className="font-medium">No se pudo transcribir.</span>{" "}
          {asset.transcriptError ?? "Probá de nuevo en un rato."}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded border border-current/30 px-2 py-1 font-medium hover:bg-current/10 disabled:opacity-50"
          >
            {retrying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RotateCcw className="h-3 w-3" aria-hidden />}
            Reintentar
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs italic text-muted-foreground">
        {asset.transcriptStatus === "pending" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />}
        {transcriptStatusLabel(asset.kind, asset.transcriptStatus)}
      </p>
      {/* Todavia no hay transcripcion: se puede pedir ya, sin esperar a la cola. */}
      {asset.transcriptStatus === "none" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {retrying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Sparkles className="h-3 w-3" aria-hidden />}
          Transcribir con IA
        </button>
      )}
    </div>
  );
}
