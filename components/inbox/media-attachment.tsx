"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Instagram,
  Loader2,
  MapPin,
  Play,
  RotateCcw,
  UserRound,
} from "lucide-react";
import type { ChatAttachment } from "@/lib/messages/attachments";
import {
  extensionLabel,
  formatBytes,
  formatDuration,
  renderPlan,
} from "@/lib/inbox/media-render";
import { cn } from "@/lib/utils";

/**
 * Un adjunto en la burbuja (F12).
 *
 * No decide nada: todas las decisiones están en `lib/inbox/media-render.ts`, que
 * es puro y testeado. Acá sólo se compone.
 *
 * **La URL se resuelve al hacer clic o al reproducir, nunca al pintar el hilo.**
 * Por eso el audio y el video arrancan como una tarjeta con un botón ▶ que monta
 * el elemento recién cuando alguien lo aprieta: un `<audio preload="metadata">`
 * pide la cabecera al pintar, así que veinte mensajes serían veinte URLs
 * firmadas que nadie va a escuchar, y encima vencen. La imagen sí carga sola
 * (con `loading="lazy"`), porque verla es justamente para lo que está.
 *
 * El ancho mínimo del reproductor va como `min(210px, 100%)` y no como `210px`:
 * en CSS `min-width` le gana a `max-width`, así que un mínimo fijo desborda una
 * burbuja más angosta (se midió: 210px dentro de un contenedor de 200px da 210).
 */
export function MediaAttachment({
  item,
  onRetry,
}: {
  item: ChatAttachment;
  /** Reintentar la descarga. Sin esto, el botón no se muestra. */
  onRetry?: () => void;
}) {
  const plan = renderPlan(item);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);

  const duration = formatDuration(item.durationSeconds);
  const size = formatBytes(item.sizeBytes);

  // Una imagen que no carga (la URL venció entre el pintado y el clic) no puede
  // quedar como un ícono roto del navegador.
  if (broken) {
    return <Note tone="muted">{plan.label} · no se pudo abrir</Note>;
  }

  switch (plan.component) {
    case "pending":
      return (
        <Note tone="muted">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {plan.label}
        </Note>
      );

    case "failed":
      return (
        <Note tone="danger">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" aria-hidden />
          <span className="min-w-0">{plan.label}</span>
          {plan.canRetry && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1 inline-flex items-center gap-1 rounded border border-current/30 px-1.5 py-0.5 text-[11px] font-medium hover:bg-current/10"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              Reintentar
            </button>
          )}
        </Note>
      );

    case "corrupt":
      return (
        <Note tone="danger">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" aria-hidden />
          {plan.label}
        </Note>
      );

    case "unavailable":
      return <Note tone="muted">{plan.label}</Note>;

    case "label":
      return (
        <Note tone="muted">
          {item.kind === "location" && <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden />}
          {item.kind === "contact" && <UserRound className="h-3 w-3 flex-shrink-0" aria-hidden />}
          {plan.label}
        </Note>
      );

    case "link-card":
      return (
        <a
          href={plan.externalUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 flex max-w-full flex-col gap-1 rounded-lg border border-current/20 px-2.5 py-2 text-xs hover:bg-current/5"
        >
          <span className="flex items-center gap-1.5 font-medium">
            {item.kind === "share" ? (
              <Instagram className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            ) : (
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{plan.label}</span>
          </span>
          {plan.shareTitle && <span className="line-clamp-3 text-current/90">{plan.shareTitle}</span>}
          {plan.shareUrlLabel && <span className="truncate text-current/50">{plan.shareUrlLabel}</span>}
        </a>
      );

    case "image":
    case "gif-image":
      return (
        <div className="mt-1.5">
          <a href={plan.url ?? undefined} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- la URL es una ruta propia que redirige a Storage: next/image no puede optimizar un 302 firmado. */}
            <img
              src={plan.url ?? undefined}
              alt={plan.label}
              loading="lazy"
              onError={() => setBroken(true)}
              className="max-h-72 w-auto max-w-full rounded-lg object-contain"
            />
          </a>
          <Footer label={plan.component === "gif-image" ? "GIF" : null} size={size} downloadUrl={plan.downloadUrl} filename={plan.filename} />
        </div>
      );

    case "gif-video":
      return (
        <div className="mt-1.5">
          <video
            src={plan.url ?? undefined}
            autoPlay
            loop
            muted
            playsInline
            onError={() => setBroken(true)}
            className="max-h-72 w-auto max-w-full rounded-lg"
          />
          <Footer label="GIF" size={size} downloadUrl={plan.downloadUrl} filename={plan.filename} />
        </div>
      );

    case "video":
      return (
        <div className="mt-1.5">
          {playing ? (
            <video
              src={plan.url ?? undefined}
              controls
              autoPlay
              playsInline
              onError={() => setBroken(true)}
              className="max-h-72 w-auto max-w-full rounded-lg dark:[color-scheme:dark]"
            />
          ) : (
            <PlayCard label={plan.label} detail={duration ?? size} onPlay={() => setPlaying(true)} />
          )}
          <Footer label={null} size={size} downloadUrl={plan.downloadUrl} filename={plan.filename} />
        </div>
      );

    case "audio":
      return (
        <div className="mt-1.5">
          {playing ? (
            <audio
              src={plan.url ?? undefined}
              controls
              autoPlay
              onError={() => setBroken(true)}
              className="h-10 w-full min-w-[min(210px,100%)] max-w-full dark:[color-scheme:dark]"
            />
          ) : (
            <PlayCard label={plan.label} detail={duration} onPlay={() => setPlaying(true)} />
          )}
          <Footer label={null} size={size} downloadUrl={plan.downloadUrl} filename={plan.filename} />
        </div>
      );

    case "document":
    default:
      return (
        <a
          href={plan.downloadUrl ?? plan.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 flex max-w-full items-center gap-2 rounded-lg border border-current/20 px-2.5 py-2 hover:bg-current/5"
        >
          <FileText className="h-4 w-4 flex-shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{plan.filename}</span>
            <span className="block text-[11px] opacity-70">
              {[extensionLabel(item), size].filter(Boolean).join(" · ") || plan.label}
            </span>
          </span>
          <Download className="h-3.5 w-3.5 flex-shrink-0 opacity-70" aria-hidden />
        </a>
      );
  }
}

/** Una línea de estado dentro de la burbuja, nunca un toast. */
function Note({ tone, children }: { tone: "muted" | "danger"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "mt-1.5 flex flex-wrap items-center gap-1.5 text-xs",
        tone === "danger" ? "text-red-700 dark:text-red-300" : "opacity-70",
      )}
    >
      {children}
    </p>
  );
}

/**
 * La tarjeta con el botón ▶.
 *
 * Es lo que hace que no se firme una URL al pintar el hilo: el `<audio>` o el
 * `<video>` se montan recién cuando alguien aprieta.
 */
function PlayCard({
  label,
  detail,
  onPlay,
}: {
  label: string;
  detail: string | null;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className="flex h-11 w-full min-w-[min(210px,100%)] max-w-full items-center gap-2.5 rounded-lg border border-current/20 px-3 text-left hover:bg-current/5"
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-current/10">
        <Play className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      {detail && <span className="flex-shrink-0 text-[11px] opacity-70">{detail}</span>}
    </button>
  );
}

/** El pie con el peso y la descarga. */
function Footer({
  label,
  size,
  downloadUrl,
  filename,
}: {
  label: string | null;
  size: string | null;
  downloadUrl: string | null;
  filename: string | null;
}) {
  if (!label && !size && !downloadUrl) return null;

  return (
    <p className="mt-1 flex items-center gap-2 text-[11px] opacity-70">
      {label && <span className="rounded bg-current/10 px-1 font-medium">{label}</span>}
      {size && <span>{size}</span>}
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
          aria-label={filename ? `Descargar ${filename}` : "Descargar el adjunto"}
        >
          <Download className="h-3 w-3" aria-hidden />
          Descargar
        </a>
      )}
    </p>
  );
}
