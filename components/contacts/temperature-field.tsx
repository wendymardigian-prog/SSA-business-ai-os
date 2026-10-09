"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { updateContact } from "@/lib/actions/contacts";
import { LEAD_TEMPERATURES, LEAD_TEMPERATURE_LABELS } from "@/lib/contacts/fields";
import { ActionError } from "./ui";

/**
 * La temperatura del lead, editable donde se lee: un selector que guarda al
 * elegir (igual que `FollowupField`). Vive en la caja "Seguimiento".
 */
export function TemperatureField({
  contactId,
  value,
  canEdit = true,
  onSaved,
}: {
  contactId: string;
  value: string | null;
  canEdit?: boolean;
  /** Despues de guardar (el panel de la bandeja carga sus datos en el navegador). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(next: string) {
    setError(null);
    start(async () => {
      const result = await updateContact(contactId, { lead_temperature: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <label htmlFor="lead-temperature" className="flex items-center gap-2 text-muted-foreground">
        Temperatura
        {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      </label>
      <select
        id="lead-temperature"
        value={value ?? ""}
        onChange={(e) => save(e.target.value)}
        disabled={pending || !canEdit}
        className="mt-2 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        <option value="">Sin definir</option>
        {LEAD_TEMPERATURES.map((t) => (
          <option key={t} value={t}>
            {LEAD_TEMPERATURE_LABELS[t]}
          </option>
        ))}
      </select>
      {error && <ActionError message={error} />}
    </div>
  );
}
