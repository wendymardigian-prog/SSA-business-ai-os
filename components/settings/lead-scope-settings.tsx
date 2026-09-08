"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateLeadScope } from "@/lib/actions/workspace";

/**
 * Scope de leads: quien ve que.
 *
 * Es la unica configuracion del sistema que cambia lo que la base le devuelve
 * a cada persona, asi que el texto tiene que dejar clarisimo el efecto. No es
 * un filtro de pantalla: con el scope prendido, un Member que consulte la API
 * directamente tampoco recibe los leads de otros.
 */
export function LeadScopeSettings({
  leadScopeEnabled,
  unassignedVisibleToMembers,
}: {
  leadScopeEnabled: boolean;
  unassignedVisibleToMembers: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(key: "leadScopeEnabled" | "unassignedVisibleToMembers", value: boolean) {
    start(async () => {
      const result = await updateLeadScope({ [key]: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Visibilidad de leads</h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="mt-4 space-y-3">
        <Toggle
          checked={leadScopeEnabled}
          onChange={(v) => toggle("leadScopeEnabled", v)}
          disabled={pending}
          label="Cada Member ve solo sus leads"
          description="Un Member ve y edita únicamente los contactos y conversaciones donde figura como setter, vendedor o agente asignado. Owner y Admin siguen viendo todo. Se aplica en la base de datos, no solo en la pantalla."
        />

        <Toggle
          checked={unassignedVisibleToMembers}
          onChange={(v) => toggle("unassignedVisibleToMembers", v)}
          disabled={pending || !leadScopeEnabled}
          label="Los leads sin asignar los ve todo el equipo"
          description={
            leadScopeEnabled
              ? "Si un lead no tiene setter, vendedor ni agente, lo ven todos los Members. Con esto apagado, solo Owner y Admin."
              : "Solo aplica con la visibilidad por lead prendida."
          }
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  label: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border border-border p-3 transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "hover:bg-accent/40",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-current"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
