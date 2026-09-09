import Link from "next/link";
import { Section, EmptyHint, formatDateTime } from "./ui";
import { enrollmentStatusStyle, pauseReasonLabel } from "@/lib/sequences/labels";
import { EnrollButton } from "@/components/sequences/enroll-button";
import type { SequenceOption } from "@/components/sequences/enroll-contact-dialog";
import type { SequenceEnrollmentStatus } from "@/lib/types/database";

export interface ContactEnrollment {
  id: string;
  sequenceId: string;
  sequenceName: string;
  status: SequenceEnrollmentStatus;
  pausedReason: string | null;
  currentStepIndex: number;
  enrolledAt: string;
  completedAt: string | null;
}

/**
 * Las secuencias por las que paso este contacto.
 *
 * Se muestran todas, no solo las que corren: saber que ya recibio una
 * bienvenida hace tres meses cambia lo que le escribis hoy.
 */
export function ContactSequencesSection({
  enrollments,
  canEnroll,
  contact,
  sequences,
}: {
  enrollments: ContactEnrollment[];
  canEnroll: boolean;
  contact: { id: string; name: string; channels: Array<{ id: string; label: string }> };
  sequences: SequenceOption[];
}) {
  return (
    <Section
      title="Secuencias"
      action={
        canEnroll ? (
          <EnrollButton contact={contact} sequences={sequences} label="Inscribir" />
        ) : undefined
      }
    >
      {enrollments.length === 0 ? (
        <EmptyHint>
          Este contacto nunca estuvo en una secuencia.{" "}
          {canEnroll
            ? "Podés inscribirlo desde acá, o dejar que lo haga un flow."
            : "Los contactos entran desde un flow o los inscribe un Owner o Admin."}
        </EmptyHint>
      ) : (
        <ul className="space-y-2">
          {enrollments.map((enrollment) => {
            const status = enrollmentStatusStyle(enrollment.status);
            const reason = pauseReasonLabel(enrollment.pausedReason);

            return (
              <li
                key={enrollment.id}
                className="flex items-start gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/sequences/${enrollment.sequenceId}`}
                      className="text-sm font-medium hover:text-primary"
                    >
                      {enrollment.sequenceName}
                    </Link>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${status.classes}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {enrollment.status === "completed" && enrollment.completedAt
                      ? `Terminó el ${formatDateTime(enrollment.completedAt)}`
                      : `Paso ${enrollment.currentStepIndex + 1}`}
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
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
