"use client";

import { PlatformIcon } from "@/components/platform-icon";
import { platformLabel } from "@/lib/platforms";
import type { MediaEntry } from "@/lib/content/media";

/**
 * Cómo se va a ver, en la red abierta (C10).
 *
 * No es un render fiel ni pretende serlo: es una silueta de teléfono con el
 * caption recortado donde lo recorta la red de verdad. Lo que resuelve es lo
 * que antes se descubría publicando — que el gancho queda debajo del "más" y
 * nadie lo lee.
 *
 * Inspirada en las vistas previas de LateWiz (MIT), rehecha con los
 * componentes del fork.
 */

/** Dónde corta cada red antes del "más". */
const PREVIEW_CHARS: Record<string, number> = {
  instagram: 125,
  tiktok: 100,
  threads: 140,
  linkedin: 210,
  youtube: 100,
  facebook: 250,
};

export function NetworkPreview({
  platform,
  caption,
  media,
  title,
  variant,
  accountName,
}: {
  platform: string;
  caption: string;
  media: MediaEntry[];
  /** El título, en las redes que lo tienen. */
  title?: string | null;
  /** Si esta red usa media propia. */
  variant?: boolean;
  accountName?: string | null;
}) {
  const limit = PREVIEW_CHARS[platform] ?? 150;
  const clipped = caption.length > limit;
  const shown = clipped ? caption.slice(0, limit).trimEnd() : caption;
  const cover = media.find((m) => m.is_cover) ?? media[0] ?? null;

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <PlatformIcon platform={platform} size={14} />
          Vista previa
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {platformLabel(platform)}
          {variant && " · variante"}
        </span>
      </div>

      <div className="p-3">
        <div className="mx-auto w-full max-w-[15rem] overflow-hidden rounded-xl border border-border bg-muted/30">
          <div className="flex items-center gap-2 px-2.5 py-2 text-[11px]">
            <span className="h-5 w-5 rounded-full bg-muted-foreground/30" aria-hidden />
            <span className="truncate font-medium">{accountName ?? "tu cuenta"}</span>
          </div>

          <div className="flex aspect-[4/5] items-center justify-center bg-muted px-3 text-center text-[11px] text-muted-foreground">
            {cover ? (
              <span>
                {cover.kind === "video" ? "▶ " : ""}
                {cover.storage_path.split("/").pop()}
              </span>
            ) : (
              <span>Sin media</span>
            )}
          </div>

          <div className="space-y-1 px-2.5 py-2 text-[11px] leading-snug">
            {title && <p className="font-semibold">{title}</p>}
            {shown ? (
              <p className="whitespace-pre-line break-words">
                {shown}
                {clipped && <span className="text-muted-foreground"> … más</span>}
              </p>
            ) : (
              <p className="text-muted-foreground">Sin caption todavía.</p>
            )}
          </div>
        </div>

        {clipped && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            En {platformLabel(platform)} se ven los primeros {limit} caracteres: lo que importa
            tiene que entrar ahí.
          </p>
        )}
      </div>
    </div>
  );
}
