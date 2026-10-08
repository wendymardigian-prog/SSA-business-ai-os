"use client";

import { useState } from "react";
import { assetThumbUrl } from "@/lib/response-assets/preview";
import type { BankAsset } from "@/lib/response-assets/list";
import { cn } from "@/lib/utils";
import { AssetKindIcon } from "./asset-kind-icon";

/**
 * El cuadradito de la izquierda de cada recurso: la imagen misma o la
 * miniatura del video, y si no hay (o no carga), el icono del tipo.
 *
 * Con `loading="lazy"`: solo se firma la URL de lo que entra en pantalla, la
 * misma regla que las imagenes de la bandeja. Una lista de 25 no pide 25
 * URLs firmadas de golpe.
 */
export function AssetThumb({
  asset,
  size = "md",
}: {
  asset: Pick<BankAsset, "kind" | "storagePath" | "previewPath" | "name">;
  size?: "sm" | "md";
}) {
  const [broken, setBroken] = useState(false);
  const url = broken ? null : assetThumbUrl(asset);
  const box = size === "sm" ? "h-9 w-9" : "h-12 w-12";

  return (
    <span
      className={cn(
        box,
        "relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground",
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- la URL es una ruta propia que redirige a Storage: next/image no puede optimizar un 302 firmado.
        <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <AssetKindIcon kind={asset.kind} className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      )}
      {url && asset.kind === "video" && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 p-0.5 text-white">
          <AssetKindIcon kind="video" className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}
