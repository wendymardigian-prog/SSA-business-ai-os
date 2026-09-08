"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { assignContact } from "@/lib/actions/contacts";
import { ActionError } from "./ui";

/**
 * Setter y vendedor (F11).
 *
 * Los dos campos son independientes: un lead puede tener setter y no vendedor,
 * los dos, o ninguno. Se guardan al cambiar el desplegable, sin boton, porque
 * es la accion mas frecuente de la ficha.
 *
 * Ojo con el scope de leads: sacarse a uno mismo de un lead con el scope
 * prendido puede hacer que la ficha deje de ser visible. Por eso el aviso.
 */

export interface WorkspaceMemberOption {
  userId: string;
  label: string;
}

export function AssignmentFields({
  contactId,
  members,
  setterId,
  vendedorId,
  currentUserId,
  isAdmin,
}: {
  contactId: string;
  members: WorkspaceMemberOption[];
  setterId: string | null;
  vendedorId: string | null;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function assign(field: "setter_id" | "vendedor_id", value: string) {
    const next = value || null;

    // Un Member que se saca a si mismo del lead deja de verlo (RLS): conviene
    // que lo sepa antes y no que la pantalla "desaparezca".
    if (
      !isAdmin &&
      next !== currentUserId &&
      (field === "setter_id" ? setterId : vendedorId) === currentUserId
    ) {
      const otro = field === "setter_id" ? vendedorId : setterId;
      if (otro !== currentUserId) {
        const ok = window.confirm(
          "Si te sacás de este lead vas a dejar de verlo. ¿Seguro?",
        );
        if (!ok) return;
      }
    }

    start(async () => {
      const result = await assignContact(contactId, { [field]: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {(
        [
          ["setter_id", "Setter", setterId, "Quien contacta y califica"],
          ["vendedor_id", "Vendedor", vendedorId, "Quien cierra"],
        ] as const
      ).map(([field, label, value, hint]) => (
        <div key={field}>
          <label
            htmlFor={`assign-${field}`}
            className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground"
          >
            {label}
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          </label>
          <select
            id={`assign-${field}`}
            value={value ?? ""}
            disabled={pending}
            onChange={(e) => assign(field, e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">Sin asignar</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>
        </div>
      ))}

      <ActionError message={error} />
    </div>
  );
}
