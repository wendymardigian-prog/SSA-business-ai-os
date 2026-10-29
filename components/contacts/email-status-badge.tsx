import { cn } from "@/lib/utils";
import { EMAIL_STATUS_LABELS, emailStatusSourceLabel, isEmailStatus, type EmailStatus } from "@/lib/email/subscription";

/**
 * El estado de email de un contacto (suscripcion a emails, 00270): "Email:
 * Suscripto / Dado de baja / Rebota / Marcó spam". El detalle (desde cuando y por
 * que) va en el `title`, que el navegador muestra al pasar el mouse.
 */

const TONE: Record<EmailStatus, string> = {
  subscribed: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
  unsubscribed: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
  bounced: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
  complained: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
};

/** "Dado de baja desde el 3 de marzo de 2025 · la persona, desde el link de baja". */
export function emailStatusDetail(input: { status: EmailStatus; at?: string | null; source?: string | null; timeZone?: string }): string {
  const parts = [EMAIL_STATUS_LABELS[input.status]];
  if (input.at) {
    try {
      const day = new Intl.DateTimeFormat("es", { dateStyle: "long", ...(input.timeZone ? { timeZone: input.timeZone } : {}) }).format(new Date(input.at));
      parts[0] = `${parts[0]} desde el ${day}`;
    } catch {
      // Una fecha o una zona invalida no rompe la ficha.
    }
  }
  if (input.status !== "subscribed" || (input.source && input.source !== "backfill")) {
    parts.push(emailStatusSourceLabel(input.source));
  }
  return parts.join(" · ");
}

export function EmailStatusBadge({
  status,
  at,
  source,
  timeZone,
  prefix = "Email: ",
  className,
}: {
  status: string | null | undefined;
  at?: string | null;
  source?: string | null;
  timeZone?: string;
  prefix?: string;
  className?: string;
}) {
  const value: EmailStatus = isEmailStatus(status) ? status : "subscribed";
  return (
    <span
      title={emailStatusDetail({ status: value, at, source, timeZone })}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONE[value], className)}
    >
      {prefix}
      {EMAIL_STATUS_LABELS[value]}
    </span>
  );
}
