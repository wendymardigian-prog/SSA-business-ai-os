import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { platformLabel } from "@/lib/platforms";

/**
 * La insignia de una red (C17).
 *
 * Todo el modulo de contenido escribia el nombre crudo: "instagram",
 * "tiktok". Ademas de feo, obliga a leer cuando alcanzaba con mirar: el
 * tablero, el calendario y la lista son pantallas para pasar la vista por
 * encima, no para leer.
 *
 * Envuelve `PlatformIcon`, que ya tiene los iconos y los colores de marca
 * desde el fork: aca no se reinventa ninguno, solo se le suma la etiqueta y
 * las formas que hacen falta en contenido.
 */

export type NetworkBadgeSize = "sm" | "md";

export function NetworkBadge({
  platform,
  /** "dot" es solo el icono; "pill" agrega el nombre. */
  variant = "pill",
  size = "md",
  className,
  /** Un texto extra a la derecha: la fecha, el estado. */
  detail,
}: {
  platform: string;
  variant?: "dot" | "pill";
  size?: NetworkBadgeSize;
  className?: string;
  detail?: string | null;
}) {
  const label = platformLabel(platform);
  const iconSize = size === "sm" ? 12 : 14;

  if (variant === "dot") {
    return (
      <span
        className={cn("inline-flex items-center", className)}
        title={label}
        aria-label={label}
      >
        <PlatformIcon platform={platform} size={iconSize} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-1.5 py-0.5",
        size === "sm" ? "text-[10px]" : "text-[11px]",
        className,
      )}
    >
      <PlatformIcon platform={platform} size={iconSize} />
      <span className="font-medium">{label}</span>
      {detail && <span className="text-muted-foreground">{detail}</span>}
    </span>
  );
}

/** Varias redes seguidas, solo los iconos. Para las tarjetas. */
export function NetworkBadges({
  platforms,
  size = "sm",
  className,
}: {
  platforms: string[];
  size?: NetworkBadgeSize;
  className?: string;
}) {
  if (platforms.length === 0) {
    return <span className="text-[11px] text-muted-foreground">Sin redes</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {platforms.map((platform) => (
        <NetworkBadge key={platform} platform={platform} variant="dot" size={size} />
      ))}
    </span>
  );
}
