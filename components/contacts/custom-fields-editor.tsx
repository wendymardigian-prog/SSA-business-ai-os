"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setContactCustomField } from "@/lib/actions/contacts";
import { ActionError, EmptyHint } from "./ui";

export interface CustomFieldItem {
  id: string;
  name: string;
  /** Los 6 tipos reales de ZernFlow: text, number, boolean, date, url, email. */
  type: string;
  value: string;
}

/**
 * Campos personalizados, editables inline.
 *
 * El tipo de cada campo solo define el input que se muestra: la validacion
 * fuerte de estos valores no existe en ZernFlow y no la agrego aca para no
 * cambiar el comportamiento de una funcionalidad que ya venia del fork.
 */
export function CustomFieldsEditor({
  contactId,
  fields,
  canManage = false,
}: {
  contactId: string;
  fields: CustomFieldItem[];
  /** Owner/Admin ven el atajo para definir campos cuando no hay ninguno. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.id, f.value])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (fields.length === 0) {
    // Antes esto era un callejon sin salida: decia que no habia campos y no
    // ofrecia ninguna forma de crear uno.
    return (
      <EmptyHint>
        No hay campos personalizados definidos.{" "}
        {canManage ? (
          <Link href="/dashboard/settings/custom-fields" className="underline hover:no-underline">
            Definí el primero
          </Link>
        ) : (
          "Un Owner o Admin los define desde Configuración."
        )}
      </EmptyHint>
    );
  }

  function save(fieldId: string, original: string) {
    const value = values[fieldId] ?? "";
    if (value === original) return;

    setSavingId(fieldId);
    start(async () => {
      const result = await setContactCustomField(contactId, fieldId, value);
      setSavingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <div key={field.id}>
          <label
            htmlFor={`cf-${field.id}`}
            className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground"
          >
            {field.name}
            {pending && savingId === field.id && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
          </label>
          <input
            id={`cf-${field.id}`}
            type={inputType(field.type)}
            value={values[field.id] ?? ""}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.id]: e.target.value }))
            }
            onBlur={() => save(field.id, field.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      ))}

      <ActionError message={error} />
    </div>
  );
}

function inputType(type: string): string {
  switch (type) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "url":
      return "url";
    case "email":
      return "email";
    default:
      return "text";
  }
}
