"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, XCircle, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { cancelEnrollment, resumeEnrollment } from "@/lib/actions/sequences";
import { ActionError, formatDateTime } from "@/components/contacts/ui";
import { enrollmentStatusStyle, isResumable, pauseReasonLabel } from "@/lib/sequences/labels";
import type { SequenceEnrollmentStatus } from "@/lib/types/database";

export interface EnrollmentRow {
  id: string;
  contactId: string;
  contactName: string;
  currentStepIndex: number;
  status: SequenceEnrollmentStatus;
  pausedReason: string | null;
  enrolledAt: string;
  hasOpenCollision: boolean;
}

export function EnrollmentList({
  enrollments,
  canManage,
  action,
}: {
  enrollments: EnrollmentRow[];
  canManage: boolean;
  /** Botón de inscribir, que arma la página (necesita datos del servidor). */
  action?: React.ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      setBusy(null);
      if (!result.ok) {
        setError(result.error ?? "No se pudo completar la acción");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="px-8 py-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Inscriptos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Los contactos que pasaron por esta secuencia
            </p>
          </div>
          {action}
        </div>

        <ActionError message={error} />

        {enrollments.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              Todavía no hay nadie inscripto
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {canManage
                ? "Podés inscribir a alguien desde acá, desde su ficha, o dejar que lo haga un flow con el nodo «Inscribir en secuencia»."
                : "Los contactos entran desde un flow o los inscribe un Owner o Admin."}
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border rounded-lg border border-border">
            {enrollments.map((enrollment) => {
              const status = enrollmentStatusStyle(enrollment.status);
              const reason = pauseReasonLabel(enrollment.pausedReason);
              const working = busy === enrollment.id;

              return (
                <div key={enrollment.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/contacts/${enrollment.contactId}`}
                        className="truncate text-sm font-medium hover:text-primary"
                      >
                        {enrollment.contactName}
                      </Link>
                      {enrollment.hasOpenCollision && (
                        <span className="inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          Colisión
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Paso {enrollment.currentStepIndex + 1}
                      <span className="mx-1.5">·</span>
                      Inscripto el {formatDateTime(enrollment.enrolledAt)}
                      {reason && (
                        <>
                          <span className="mx-1.5">·</span>
                          {reason}
                        </>
                      )}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      status.classes
                    )}
                  >
                    {status.label}
                  </span>

                  {canManage && isResumable(enrollment.status, enrollment.pausedReason) && (
                    <button
                      onClick={() => run(enrollment.id, () => resumeEnrollment(enrollment.id))}
                      disabled={working}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400"
                      title="Reanudar la inscripción"
                      aria-label={`Reanudar la inscripción de ${enrollment.contactName}`}
                    >
                      {working ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}

                  {canManage &&
                    (enrollment.status === "active" || enrollment.status === "paused") && (
                      <button
                        onClick={() => run(enrollment.id, () => cancelEnrollment(enrollment.id))}
                        disabled={working}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        title="Sacar de la secuencia"
                        aria-label={`Sacar a ${enrollment.contactName} de la secuencia`}
                      >
                        {working ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
