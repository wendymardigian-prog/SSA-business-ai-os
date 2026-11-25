"use client";

/**
 * Quién estuvo en una grabación, en la lista: la foto del host primero, hasta 3 círculos de invitados con «+N» y, al
 * lado, «Con Ana López, pedro@x.com y 2 más». Al pasar el mouse, la lista completa. Las reglas (quién es host, quién
 * invitado, sin repetir) están en `lib/calls/participants.ts`; acá solo se dibuja.
 */
import { UserAvatar } from "@/components/account/user-avatar";
import { useMemberAvatar } from "@/components/account/member-avatars";
import { Tip } from "@/components/ui/tooltip";
import { colorOf, initialsOf } from "@/lib/shared/people";
import { participantsLine, type CallParticipants, type CallPerson } from "@/lib/calls/participants";
import { cn } from "@/lib/utils";

const SHOWN = 3;

function PersonCircle({ person, host }: { person: CallPerson; host?: boolean }) {
  const memberPhoto = useMemberAvatar(person.userId);
  return (
    <span className={cn("rounded-full ring-2 ring-background", host && "ring-primary-edge")}>
      <UserAvatar src={memberPhoto ?? person.avatarUrl} initials={initialsOf(person.label)} size={24} color={colorOf(person.email ?? person.label)} />
    </span>
  );
}

export function CallPeople({ participants, fallback }: { participants: CallParticipants; fallback?: string | null }) {
  const { host, guests } = participants;
  if (!host && guests.length === 0) return fallback ? <span className="truncate text-muted-foreground">{fallback}</span> : <span className="text-muted-foreground">—</span>;
  const shown = guests.slice(0, SHOWN);
  const rest = guests.length - shown.length;
  const line = participantsLine(guests) ?? fallback ?? null;
  const fullLines = [host ? `Host: ${host.label}` : null, ...guests.map((g) => (g.email && g.email !== g.label ? `${g.label} (${g.email})` : g.label))].filter((l): l is string => Boolean(l));
  return (
    <Tip
      className="min-w-0"
      content={fullLines.map((l, i) => (
        <span key={i} className="block">
          {l}
        </span>
      ))}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center -space-x-1.5" aria-hidden>
          {host && <PersonCircle person={host} host />}
          {shown.map((g, i) => (
            <PersonCircle key={`${g.email ?? g.label}-${i}`} person={g} />
          ))}
          {rest > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-background">+{rest}</span>}
        </span>
        <span className="sr-only">{fullLines.join(". ")}</span>
        {line && <span className="truncate text-xs text-muted-foreground" aria-hidden>{line}</span>}
      </span>
    </Tip>
  );
}
