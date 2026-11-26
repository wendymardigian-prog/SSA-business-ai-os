"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Ban, RotateCcw, Merge } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { setDoNotContact, softDeleteContact } from "@/lib/actions/contacts";
import { encodeMergeParam } from "@/lib/contacts/merge";
import { ActionError } from "./ui";
import { MergeContactDialog } from "./merge-contact-dialog";
import { Tip } from "@/components/ui/tooltip";

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
  canMerge = false,
}: {
  contactId: string;
  doNotContact: boolean;
  doNotContactReason: string | null;
  isAdmin: boolean;
  /** `contacts.merge`: «Unir con otro contacto». */
  canMerge?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [merging, setMerging] = useState(false);
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
      <Tip content={doNotContact && !isAdmin ? "Solo Owner y Admin pueden sacar esta marca" : undefined}>
        <button
          onClick={toggleDoNotContact}
          disabled={pending || (doNotContact && !isAdmin)}
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
      </Tip>

      {canMerge && (
        <button
          onClick={() => setMerging(true)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Merge className="h-3.5 w-3.5" />
          Unir con otro contacto
        </button>
      )}

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

      {merging && (
        <MergeContactDialog
          contactId={contactId}
          onClose={() => setMerging(false)}
          onMerged={(mainId, moved) => {
            setMerging(false);
            // Mismo destino que la sugerencia de vinculacion: la ficha del que quedo, con lo que se unifico.
            router.push(`/dashboard/contacts/${mainId}?fusion=${encodeMergeParam(moved) || "ok"}`);
            router.refresh();
          }}
        />
      )}

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
