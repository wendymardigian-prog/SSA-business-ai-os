"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hand, Loader2 } from "lucide-react";
import { Avatar, FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { colorOf, initialsOf } from "@/lib/shared/people";
import { assigneeControl, assigneeName, assigneeOptions, type TeamMember } from "@/lib/inbox/assignee";
import { setConversationAssignee } from "@/lib/actions/conversation-assign";

/**
 * El responsable de la conversacion, en la cabecera del chat.
 *
 * - Con `contacts.assign`: un boton con las iniciales que abre la lista del
 *   equipo (y "Sin responsable").
 * - Sin la clave y sin responsable: "Tomar" (se la asigna a quien mira).
 * - Si no: solo el circulo, con el nombre en el tooltip.
 *
 * Que se muestra lo decide `assigneeControl` (lib/inbox/assignee.ts).
 */
export function ConversationAssignee({
  conversationId,
  assignedTo,
  members,
  currentUserId,
  canAssign,
  canReply,
}: {
  conversationId: string;
  assignedTo: string | null;
  members: TeamMember[];
  currentUserId: string;
  canAssign: boolean;
  canReply: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimista: el cambio se ve al instante y vuelve atras si falla.
  const [shown, setShown] = useState<string | null>(assignedTo);
  const [lastProp, setLastProp] = useState<string | null>(assignedTo);
  if (assignedTo !== lastProp) {
    setLastProp(assignedTo);
    setShown(assignedTo);
  }

  const control = assigneeControl({ canAssign, canReply, viewerId: currentUserId, current: shown });
  const name = assigneeName(members, shown);

  function change(next: string | null) {
    const previous = shown;
    setShown(next);
    setError(null);
    startTransition(async () => {
      const result = await setConversationAssignee({ conversationId, userId: next });
      if (!result.ok) {
        setShown(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const circle = shown ? (
    <Avatar initials={initialsOf(name ?? "?")} color={colorOf(shown)} size="md" />
  ) : (
    <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground" aria-hidden>
      ?
    </span>
  );
  const label = shown ? `Responsable: ${name ?? "alguien que ya no está en el equipo"}` : "Sin responsable";

  if (control.kind === "take") {
    return (
      <span className="inline-flex items-center">
        <button
          type="button"
          onClick={() => change(currentUserId)}
          disabled={pending}
          title="Asignarme esta conversación"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Hand className="h-4 w-4" aria-hidden />}
          <span className="hidden md:inline">Tomar</span>
        </button>
        {error && <ErrorNote text={error} />}
      </span>
    );
  }

  if (control.kind === "readonly") {
    return (
      <span title={label} role="img" aria-label={label} className="inline-flex h-9 items-center px-1">
        {circle}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <FilterMenu label={label} active={false} compact icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : circle} menuClassName="topbar:w-[260px]">
        <MenuGroupLabel>Responsable del chat</MenuGroupLabel>
        <MenuOption checked={!shown} onSelect={() => change(null)} title="Sin responsable" />
        {assigneeOptions(members, shown).map((m) => (
          <MenuOption
            key={m.userId}
            checked={shown === m.userId}
            onSelect={() => change(m.userId)}
            leading={<Avatar initials={initialsOf(m.label)} color={colorOf(m.userId)} size="sm" />}
            title={m.userId === currentUserId ? `${m.label} (vos)` : m.label}
          />
        ))}
      </FilterMenu>
      {error && <ErrorNote text={error} />}
    </span>
  );
}

/** El error, a la vista: una palabra en rojo y el detalle completo para el lector de pantalla y el tooltip. */
function ErrorNote({ text }: { text: string }) {
  return (
    <span role="alert" title={text} className="max-w-[9rem] truncate text-[11px] font-medium text-red-600 dark:text-red-400">
      {text}
    </span>
  );
}
