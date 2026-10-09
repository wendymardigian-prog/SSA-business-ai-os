"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Ban, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { setDoNotContact, softDeleteContact } from "@/lib/actions/contacts";
import { ActionError } from "./ui";

/**
 * Las acciones de la ficha: marcar o sacar "no contactar" y eliminar.
 *
 * Antes este componente era `ContactEditor` y tambien traia el boton "Editar":
 * un formulario de quince campos en una pantalla aparte (y sin scroll). Los
 * datos ahora se editan donde se leen (`InlineField`, `ContactDataSection`), asi
 * que aca quedan solo las acciones.
 */
export function ContactActions({
  contactId,
  doNotContact,
  doNotContactReason,
  isAdmin,
}: {
  contactId: string;
  doNotContact: boolean;
  doNotContactReason: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  function toggleDoNotContact() {
    start(async () => {
      const result = await setDoNotContact(contactId, !doNotContact);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const result = await softDeleteContact(contactId);
      setConfirmDelete(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/contacts");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={toggleDoNotContact}
        disabled={pending || (doNotContact && !isAdmin)}
        title={doNotContact && !isAdmin ? "Solo Owner y Admin pueden sacar esta marca" : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          doNotContact
            ? "border-input hover:bg-accent"
            : "border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
        )}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : doNotContact ? (
          <RotateCcw className="h-3.5 w-3.5" />
        ) : (
          <Ban className="h-3.5 w-3.5" />
        )}
        {doNotContact ? "Sacar marca de no contactar" : "Marcar como no contactar"}
      </button>

      {isAdmin && (
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar
        </button>
      )}

      {doNotContact && doNotContactReason && (
        <span className="text-xs text-muted-foreground">Motivo: {doNotContactReason}</span>
      )}

      <ActionError message={error} />

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar contacto"
        message="El contacto y sus conversaciones dejan de aparecer en los listados. Se pueden restaurar durante 30 dias; despues se borran para siempre."
        confirmLabel="Eliminar"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
