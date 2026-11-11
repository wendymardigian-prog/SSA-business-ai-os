"use client";

import { Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/filter-menu";
import { PortalMenu, PortalMenuItem, PortalMenuLabel } from "@/components/ui/portal-menu";
import { assigneeName, assigneeOptions, type TeamMember } from "@/lib/inbox/assignee";
import { colorOf, initialsOf } from "@/lib/shared/people";

/**
 * Selector chico de una persona del equipo: el boton muestra SOLO la foto (o la inicial) y la lista que
 * se abre muestra los nombres completos. Lo usa «Estado del lead» para el setter y el vendedor.
 *
 * Usa `PortalMenu` (se dibuja en el `<body>`): el panel de la bandeja tiene scroll y un menu `absolute`
 * quedaria recortado. No guarda nada: avisa con `onChange` y quien lo usa decide (`assignContact`). Sin `canAssign` se ve
 * la foto sin menu, con el nombre en el tooltip. La lista mantiene a alguien que ya no esta en el
 * equipo si es el valor actual (`assigneeOptions`).
 */
export function MemberPicker({
  value,
  members,
  currentUserId,
  canAssign,
  pending = false,
  label,
  emptyLabel = "Sin asignar",
  groupLabel,
  onChange,
}: {
  value: string | null;
  members: TeamMember[];
  currentUserId: string;
  canAssign: boolean;
  pending?: boolean;
  /** «Setter», «Vendedor»: va en el tooltip y en el nombre accesible del boton. */
  label: string;
  emptyLabel?: string;
  groupLabel?: string;
  onChange: (next: string | null) => void;
}) {
  const name = assigneeName(members, value);
  const circle = value ? (
    <Avatar initials={initialsOf(name ?? "?")} color={colorOf(value)} size="md" userId={value} />
  ) : (
    <span
      className="grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground"
      aria-hidden
    >
      ?
    </span>
  );
  const description = value
    ? `${label}: ${name ?? "alguien que ya no está en el equipo"}`
    : `${label}: ${emptyLabel.toLowerCase()}`;

  if (!canAssign) {
    return (
      <span title={description} role="img" aria-label={description} className="inline-flex h-9 shrink-0 items-center px-1">
        {circle}
      </span>
    );
  }

  return (
    <PortalMenu
      label={description}
      title={description}
      align="end"
      width={260}
      disabled={pending}
      triggerClassName="h-9 w-9 shrink-0 justify-center rounded-lg border border-input bg-background transition-colors hover:border-muted-foreground/60"
      trigger={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : circle}
    >
      <PortalMenuLabel>{groupLabel ?? label}</PortalMenuLabel>
      <PortalMenuItem selected={!value} onSelect={() => onChange(null)}>
        {emptyLabel}
      </PortalMenuItem>
      {assigneeOptions(members, value).map((m) => (
        <PortalMenuItem key={m.userId} selected={value === m.userId} onSelect={() => onChange(m.userId)}>
          <Avatar initials={initialsOf(m.label)} color={colorOf(m.userId)} size="sm" userId={m.userId} />
          <span className="truncate">{m.userId === currentUserId ? `${m.label} (vos)` : m.label}</span>
        </PortalMenuItem>
      ))}
    </PortalMenu>
  );
}
