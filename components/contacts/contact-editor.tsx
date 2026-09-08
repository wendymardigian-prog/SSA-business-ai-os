"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2, Ban, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  CONTACT_FIELDS,
  LEAD_TEMPERATURES,
  LEAD_TEMPERATURE_LABELS,
  validateContactField,
  type ContactFieldKey,
} from "@/lib/contacts/fields";
import {
  updateContact,
  setDoNotContact,
  softDeleteContact,
} from "@/lib/actions/contacts";
import { ActionError } from "./ui";

/**
 * Formulario de edicion de la ficha (F14).
 *
 * Valida con las mismas funciones que el servidor (lib/contacts/fields.ts):
 * aca es para avisar mientras se escribe, alla es la barrera de verdad.
 * Nunca al reves — si esta validacion fuera la unica, alcanzaria con llamar al
 * Server Action desde afuera para meter cualquier cosa.
 */

type Values = Partial<Record<ContactFieldKey, string>>;

export function ContactEditor({
  contactId,
  initial,
  doNotContact,
  doNotContactReason,
  isAdmin,
}: {
  contactId: string;
  initial: Values;
  doNotContact: boolean;
  doNotContactReason: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values>(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  function set(key: ContactFieldKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    // El error se limpia al escribir: dejarlo colgado mientras la persona ya
    // esta corrigiendo solo confunde.
    if (error) setError(null);
  }

  function save() {
    // Chequeo local primero: asi el error sale al instante y sin round trip.
    for (const field of CONTACT_FIELDS) {
      const result = validateContactField(field.key, values[field.key] ?? null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
    }

    start(async () => {
      const result = await updateContact(contactId, values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

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

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>

        <button
          onClick={toggleDoNotContact}
          disabled={pending || (doNotContact && !isAdmin)}
          title={
            doNotContact && !isAdmin
              ? "Solo Owner y Admin pueden sacar esta marca"
              : undefined
          }
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
          <span className="text-xs text-muted-foreground">
            Motivo: {doNotContactReason}
          </span>
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

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {CONTACT_FIELDS.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`contact-${field.key}`}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              {field.label}
            </label>

            {field.kind === "temperature" ? (
              <select
                id={`contact-${field.key}`}
                value={values[field.key] ?? ""}
                onChange={(e) => set(field.key, e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Sin definir</option>
                {LEAD_TEMPERATURES.map((t) => (
                  <option key={t} value={t}>
                    {LEAD_TEMPERATURE_LABELS[t]}
                  </option>
                ))}
              </select>
            ) : field.key === "ai_conversation_summary" ? (
              <textarea
                id={`contact-${field.key}`}
                rows={3}
                value={values[field.key] ?? ""}
                onChange={(e) => set(field.key, e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <input
                id={`contact-${field.key}`}
                type={field.kind === "date" ? "datetime-local" : "text"}
                value={toInputValue(field.kind, values[field.key])}
                onChange={(e) => set(field.key, e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}

            {field.hint && (
              <p className="mt-1 text-xs text-muted-foreground/70">{field.hint}</p>
            )}
          </div>
        ))}
      </div>

      <ActionError message={error} />

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar
        </button>
        <button
          onClick={() => {
            setValues(initial);
            setError(null);
            setEditing(false);
          }}
          disabled={pending}
          className="rounded-lg border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * <input type="datetime-local"> no acepta un ISO con zona: quiere
 * "YYYY-MM-DDTHH:mm" en hora local. La base guarda UTC, asi que hay que
 * traducir en los dos sentidos.
 */
function toInputValue(kind: string, value: string | undefined): string {
  if (kind !== "date" || !value) return value ?? "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
