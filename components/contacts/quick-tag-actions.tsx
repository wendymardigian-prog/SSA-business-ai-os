"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BotOff, Loader2 } from "lucide-react";
import { toggleContactTag } from "@/lib/actions/contacts";
import { describeEffect, hasEffect, sortEffectFirst } from "@/lib/tags/effects";
import { ActionError } from "./ui";
import type { TagOption } from "./tags-editor";

/**
 * Acciones rapidas (Bloque 2d-A): las etiquetas con efecto sobre el agente, a
 * un clic desde el panel de la bandeja y la ficha. El peor error del sistema
 * es que el agente le ofrezca la academia a un amigo de Wendy; marcarlo tiene
 * que estar a mano, y decir antes que va a pasar.
 *
 * El efecto (apagar el agente, asignar) lo aplica la base (00073). Aca solo se
 * pone o se saca la etiqueta, de a una, sin pisar las demas.
 */
export function QuickTagActions({
  contactId,
  allTags,
  assignedIds,
  memberNames,
  onSaved,
}: {
  contactId: string;
  allTags: TagOption[];
  assignedIds: string[];
  /** userId -> nombre, para decir a quien asigna. */
  memberNames: Record<string, string>;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const effectTags = sortEffectFirst(
    allTags
      .map((t) => ({ ...t, disablesAgent: t.disablesAgent ?? false, assignsTo: t.assignsTo ?? null }))
      .filter((t) => hasEffect(t)),
  );
  if (effectTags.length === 0) return null;

  function toggle(tagId: string, on: boolean) {
    setError(null);
    setPendingId(tagId);
    start(async () => {
      const result = await toggleContactTag(contactId, tagId, on);
      setPendingId(null);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className="space-y-2">
      {effectTags.map((tag) => {
        const has = assignedIds.includes(tag.id);
        const busy = pendingId === tag.id;
        const effect = describeEffect(tag, tag.assignsTo ? (memberNames[tag.assignsTo] ?? null) : null);
        return has ? (
          <div key={tag.id} className="rounded-lg border border-red-300 bg-red-50 p-2.5 dark:border-red-900 dark:bg-red-950/30">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-800 dark:text-red-200">
              <BotOff className="h-3.5 w-3.5" aria-hidden />
              Marcado «{tag.name}»
            </p>
            {tag.disablesAgent && (
              <p className="mt-0.5 text-[11px] text-red-800/80 dark:text-red-200/80">
                El agente está apagado en sus conversaciones. Si en una hace falta, se prende a mano desde el hilo.
              </p>
            )}
            <button
              type="button"
              onClick={() => toggle(tag.id, false)}
              disabled={busy}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 md:min-h-0"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Sacar «{tag.name}»
            </button>
          </div>
        ) : (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.id, true)}
            disabled={busy}
            className="flex min-h-11 w-full flex-col items-start rounded-lg border border-input px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BotOff className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden />}
              Marcar como «{tag.name}»
            </span>
            {effect && <span className="mt-0.5 text-[11px] text-muted-foreground">{effect}.</span>}
          </button>
        );
      })}
      <ActionError message={error} />
    </div>
  );
}
