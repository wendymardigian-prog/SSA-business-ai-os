"use client";

import { UserAvatar } from "@/components/account/user-avatar";
import { useMemberAvatar } from "@/components/account/member-avatars";
import { Tip } from "@/components/ui/tooltip";
import { colorOf, initialsOf } from "@/lib/shared/people";
import { cn } from "@/lib/utils";

/**
 * EL circulo de una persona del equipo (24/11/2026): su foto de Mi cuenta (`MemberAvatarsProvider`) o, si no tiene o no
 * carga, sus iniciales sobre su color. Al pasar el mouse dice al instante quien es («Vendedor: Ana Lopez»), con el tooltip
 * del sistema. Sin persona: un circulo punteado con «?» y su texto («Sin asignar»).
 *
 * Es el que se usa en todos lados donde aparece alguien del equipo (responsable, setter, vendedor, anfitrion…):
 * no se arman iniciales a mano ni un cuadrado.
 */
export type PersonAvatarSize = "sm" | "md" | "lg";
const PX: Record<PersonAvatarSize, number> = { sm: 18, md: 22, lg: 24 };

export function PersonAvatar({
  userId,
  name,
  role,
  size = "md",
  showName = false,
  emptyLabel = "Sin asignar",
  className,
  nameClassName,
}: {
  userId: string | null | undefined;
  /** El nombre de la persona; sin nombre se toma como «sin persona». */
  name: string | null | undefined;
  /** Lo que es en ese lugar («Vendedor», «Responsable», «Anfitrión»…): el tooltip dice «Vendedor: Ana López». */
  role?: string;
  size?: PersonAvatarSize;
  /** El nombre al lado del circulo (en una columna de tabla, por ejemplo). */
  showName?: boolean;
  /** El texto cuando no hay persona («Sin asignar»). */
  emptyLabel?: string;
  className?: string;
  nameClassName?: string;
}) {
  const photo = useMemberAvatar(userId ?? null);
  const px = PX[size];
  const cleanName = name?.trim() || null;

  if (!cleanName) {
    const circle = (
      <span
        role="img"
        aria-label={emptyLabel}
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground"
        style={{ width: px, height: px, fontSize: Math.max(9, Math.round(px * 0.45)) }}
      >
        ?
      </span>
    );
    return (
      <Tip asChild content={emptyLabel}>
        <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
          {circle}
          {showName && <span className={cn("truncate text-muted-foreground", nameClassName)}>{emptyLabel}</span>}
        </span>
      </Tip>
    );
  }

  const label = role ? `${role}: ${cleanName}` : cleanName;
  return (
    <Tip asChild content={label}>
      <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
        <span role="img" aria-label={label} className="inline-flex shrink-0">
          <UserAvatar src={photo} initials={initialsOf(cleanName)} size={px} color={userId ? colorOf(userId) : undefined} />
        </span>
        {showName && <span className={cn("truncate", nameClassName)}>{cleanName}</span>}
      </span>
    </Tip>
  );
}
