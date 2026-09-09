"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { resolveCollision } from "@/lib/actions/sequences";
import { ActionError } from "@/components/contacts/ui";
import type { SequenceCollisionResolution } from "@/lib/types/database";

export interface CollisionRow {
  enrollmentId: string;
  contactId: string;
  contactName: string;
  with: Array<{ sequence_id: string; sequence_name: string }>;
}

const DECISIONS: Array<{
  key: SequenceCollisionResolution;
  label: string;
  hint: string;
}> = [
  {
    key: "kept_both",
    label: "Dejar las dos",
    hint: "Las dos siguen corriendo. Queda anotado que lo decidiste vos.",
  },
  {
    key: "paused_other",
    label: "Pausar la otra",
    hint: "La otra queda frenada y la podés reanudar cuando quieras.",
  },
  {
    key: "removed_other",
    label: "Sacarlo de la otra",
    hint: "Se cancela la inscripción a la otra secuencia.",
  },
  {
    key: "removed_this",
    label: "Sacarlo de esta",
    hint: "Se cancela esta inscripción y sigue la otra.",
  },
];

/**
 * Aviso de colision (F13).
 *
 * El centro de notificaciones es del Bloque 3; hasta entonces la colision se
 * ve aca. Cuando exista, va a leer las mismas filas (listOpenCollisions) y
 * esto no cambia.
 */
export function CollisionAlert({
  collisions,
  canResolve,
}: {
  collisions: CollisionRow[];
  canResolve: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (collisions.length === 0) return null;

  function decide(enrollmentId: string, resolution: SequenceCollisionResolution) {
    setBusy(enrollmentId);
    setError(null);
    startTransition(async () => {
      const result = await resolveCollision(enrollmentId, resolution);
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-amber-900 dark:text-amber-300">
            {collisions.length === 1
              ? "Un contacto está en más de una secuencia por el mismo canal"
              : `${collisions.length} contactos están en más de una secuencia por el mismo canal`}
          </h3>
          <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-400/80">
            Van a recibir mensajes de las dos. Decidí qué hacer con cada uno; queda anotado
            en el historial del contacto.
          </p>

          <ActionError message={error} />

          <ul className="mt-3 space-y-3">
            {collisions.map((collision) => (
              <li
                key={collision.enrollmentId}
                className="rounded-lg border border-amber-200/70 bg-background/60 p-3 dark:border-amber-900/40"
              >
                <p className="text-sm">
                  <Link
                    href={`/dashboard/contacts/${collision.contactId}`}
                    className="font-medium hover:underline"
                  >
                    {collision.contactName}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}también está en{" "}
                    {collision.with.map((w, i) => (
                      <span key={w.sequence_id}>
                        {i > 0 && ", "}
                        <Link
                          href={`/dashboard/sequences/${w.sequence_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {w.sequence_name}
                        </Link>
                      </span>
                    ))}
                  </span>
                </p>

                {canResolve ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {DECISIONS.map((decision) => (
                      <button
                        key={decision.key}
                        onClick={() => decide(collision.enrollmentId, decision.key)}
                        disabled={busy === collision.enrollmentId}
                        title={decision.hint}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        {busy === collision.enrollmentId && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        {decision.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Un Owner o Admin decide qué hacer.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
