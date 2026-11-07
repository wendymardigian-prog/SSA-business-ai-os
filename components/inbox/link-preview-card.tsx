"use client";

import { memo, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useLinkPreview } from "./use-link-preview";

/** Cuanto tiene que quedarse en pantalla: al abrir un chat, el scroll pasa por todos los mensajes y no hay que pedirlos. */
const VISIBLE_BEFORE_LOADING_MS = 300;

function PreviewBody({ href, preview, compact = false }: { href: string; preview: NonNullable<ReturnType<typeof useLinkPreview>>; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = preview.image && !imageFailed;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        "overflow-hidden rounded-lg border border-current/20 bg-black/5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/5",
        compact ? "flex max-w-md items-stretch" : "block w-64 max-w-full",
      )}
    >
      {showImage && (
        <span className={cn("relative block", compact ? "w-16 shrink-0" : "h-32 w-full")}>
          {/* Sin optimizador (next.config.ts, `images.unoptimized`): es un <img> directo, la pide el navegador.
              El servidor nunca baja una imagen ajena; a cambio, el sitio ve la IP de quien mira. Sin referrer,
              para que no sepa desde qué pantalla se abrió. */}
          <Image src={preview.image!} alt="" fill sizes={compact ? "64px" : "256px"} className="object-cover" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        </span>
      )}
      <span className="block min-w-0 space-y-0.5 px-3 py-2">
        <span className="block truncate text-[11px] opacity-70">{preview.siteName}</span>
        <span className={cn("text-sm font-medium", compact ? "block truncate" : "line-clamp-2")}>{preview.title}</span>
        {preview.description && <span className={cn("text-xs opacity-80", compact ? "block truncate" : "line-clamp-2")}>{preview.description}</span>}
      </span>
    </a>
  );
}

/** La tarjeta de un mensaje: pide los datos recien cuando el mensaje se queda en pantalla. Sin datos, no ocupa lugar. */
export const MessageLinkCard = memo(function MessageLinkCard({ url }: { url: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const preview = useLinkPreview(url, visible);

  useEffect(() => {
    const element = anchor.current;
    if (!element || visible) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (entry?.isIntersecting) timer = setTimeout(() => setVisible(true), VISIBLE_BEFORE_LOADING_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [visible]);

  return <div ref={anchor}>{preview && <div className="mt-2"><PreviewBody key={url} href={url} preview={preview} /></div>}</div>;
});

/** La tarjeta del composer: baja y en una fila, para no comerse el hilo, con la aclaracion de cada canal. */
export const ComposerLinkCard = memo(function ComposerLinkCard({ url, notice }: { url: string; notice: string | null }) {
  const preview = useLinkPreview(url, true);
  if (!preview) return null;
  return (
    <div className="mb-2 rounded-lg border border-border bg-muted/40 p-2 text-foreground">
      <PreviewBody key={url} href={url} preview={preview} compact />
      <p className="mt-1.5 text-[11px] text-muted-foreground">Vista previa aproximada.{notice ? ` ${notice}` : ""}</p>
    </div>
  );
});
