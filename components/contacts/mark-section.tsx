"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setCustomer, setKnown } from "@/lib/actions/contacts";
import { canUnmarkMark, markLabel, type ContactMark } from "@/lib/inbox/marks";
import { ActionError } from "@/components/contacts/ui";
import { MARK_STYLE } from "@/components/contacts/mark-badge";

/**
 * Marcar o quitar "Conocido" (00256) o "Cliente" (00268) desde el panel de la
 * bandeja o la ficha. Marcar lo hace cualquiera que edite contactos; quitar,
 * quien la puso o un administrador (el servidor lo repite).
 */

// La marca automatica existe solo donde se registran cobros; si no, el texto no la menciona.
const AUTO_NOTE = " Se marca solo cuando se cobra una venta."; // @plantilla-quitar(ventas)
// @plantilla-sin(ventas): const AUTO_NOTE = "";

const TEXT: Record<ContactMark, { title: string; off: string; on: string; markButton: string }> = {
  known: {
    title: "Conocido",
    off: "Para alguien personal: el equipo lo ve con un ícono y no lo abre, el agente no le responde y sus chats van a la persona de cada cuenta.",
    on: "El agente no le responde y sus secuencias están pausadas.",
    markButton: "Marcar como conocido",
  },
  customer: {
    title: "Cliente",
    off: `Para quien ya compró: el equipo lo ve con un ícono y no lo abre, el agente no le responde y sus secuencias se pausan.${AUTO_NOTE}`,
    on: "El agente no le responde y sus secuencias están pausadas.",
    markButton: "Marcar como cliente",
  },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

export function MarkSection({
  mark,
  contactId,
  marked,
  markedBy,
  markedByName,
  markedAt,
  source,
  currentUserId,
  canEdit,
  canDeleteContacts,
  onSaved,
  className,
}: {
  mark: ContactMark;
  contactId: string;
  marked: boolean;
  markedBy: string | null;
  markedByName: string | null;
  markedAt: string | null;
  /** Cliente: "manual" o "sale". */
  source?: string | null;
  currentUserId: string;
  canEdit: boolean;
  canDeleteContacts: boolean;
  /** Sin esto, se recarga la pagina (la ficha). */
  onSaved?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { icon: Icon, text, chip } = MARK_STYLE[mark];
  const copy = TEXT[mark];
  const canUnmark = canEdit && canUnmarkMark({ viewerId: currentUserId, markedBy, canDeleteContacts });

  function apply(next: boolean) {
    start(async () => {
      const result = mark === "known" ? await setKnown(contactId, next) : await setCustomer(contactId, next);
      if (!result.ok) return setError(result.error);
      setError(null);
      if (onSaved) onSaved();
      else router.refresh();
    });
  }

  return (
    <section className={cn("space-y-2", className)}>
      <h4 className={cn("flex items-center gap-1.5 text-xs font-medium uppercase", text)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {copy.title}
      </h4>
      {marked ? (
        <>
          <p className="text-xs text-muted-foreground">
            {markLabel(mark, markedByName, source)}
            {markedAt ? `, desde el ${formatDate(markedAt)}` : ""}. {copy.on}
          </p>
          {canUnmark ? (
            <button
              type="button"
              onClick={() => apply(false)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Quitar la marca
            </button>
          ) : (
            canEdit && <p className="text-[11px] text-muted-foreground">Solo quien lo marcó o un administrador puede quitar la marca.</p>
          )}
        </>
      ) : canEdit ? (
        <>
          <p className="text-xs text-muted-foreground">{copy.off}</p>
          <button
            type="button"
            onClick={() => apply(true)}
            disabled={pending}
            className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80 disabled:opacity-50", chip)}
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5" aria-hidden />}
            {copy.markButton}
          </button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Sin marcar.</p>
      )}
      <ActionError message={error} />
    </section>
  );
}
