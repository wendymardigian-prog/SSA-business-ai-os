"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * El circulo de una persona del equipo: su foto (00273) o, si no tiene o no
 * carga, sus iniciales. Para los avatares chicos de las listas esta `Avatar`
 * (components/ui/filter-menu.tsx), que hace lo mismo a 18 y 22 px.
 */
export function UserAvatar({
  src,
  initials,
  size = 32,
  className,
  color,
}: {
  src?: string | null;
  initials: string;
  /** Lado en px. */
  size?: number;
  className?: string;
  /** Color de fondo de las iniciales; sin color, el del negocio suave. */
  color?: string;
}) {
  // La URL que fallo, no un booleano: si cambia la foto, se vuelve a intentar.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) };

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- foto chica de Storage; next/image no suma nada aca
      <img
        src={src!}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        onError={() => setFailedSrc(src ?? null)}
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={style}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        color ? "text-white" : "bg-primary/15 text-primary",
        className,
      )}
      style={color ? { ...style, backgroundColor: color } : style}
    >
      {initials}
    </span>
  );
}
