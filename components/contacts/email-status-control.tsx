"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailX, MailCheck } from "lucide-react";
import { setContactEmailStatus } from "@/lib/actions/contact-email-status";
import { isEmailStatus, type EmailStatus } from "@/lib/email/subscription";
import { EmailStatusBadge } from "./email-status-badge";
import { ActionError } from "./ui";

/**
 * El estado de email en la ficha (suscripcion a emails, E5): el badge (con fecha y
 * motivo al pasar el mouse) y el boton "Dar de baja de emails" / "Volver a
 * suscribir". Volver a suscribir a alguien cuyo email rebota o que marco spam pide
 * un motivo y avisa del riesgo. Si el email secundario tiene otro estado (porque
 * otro contacto con esa direccion se dio de baja), se muestran los dos.
 */
export function EmailStatusControl({
  contactId,
  status,
  at,
  source,
  secondary,
  canEdit,
  timeZone,
}: {
  contactId: string;
  status: string;
  at: string | null;
  source: string | null;
  /** El estado efectivo del email secundario, solo si es distinto del principal. */
  secondary?: { status: string } | null;
  canEdit: boolean;
  timeZone?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState("");
  const current: EmailStatus = isEmailStatus(status) ? status : "subscribed";
  const risky = current === "bounced" || current === "complained";

  function save(next: "subscribed" | "unsubscribed", why?: string) {
    setError(null);
    start(async () => {
      const result = await setContactEmailStatus(contactId, next, why ?? null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAskingReason(false);
      setReason("");
      router.refresh();
    });
  }

  const button =
    "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <EmailStatusBadge status={current} at={at} source={source} timeZone={timeZone} prefix={secondary ? "Email principal: " : "Email: "} />
        {secondary && <EmailStatusBadge status={secondary.status} prefix="Email secundario: " />}
        {canEdit && current === "subscribed" && (
          <button type="button" disabled={pending} onClick={() => save("unsubscribed")} className={button}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailX className="h-3.5 w-3.5" />}
            Dar de baja de emails
          </button>
        )}
        {canEdit && current !== "subscribed" && !askingReason && (
          <button
            type="button"
            disabled={pending}
            onClick={() => (risky ? setAskingReason(true) : save("subscribed"))}
            className={button}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />}
            Volver a suscribir
          </button>
        )}
      </div>

      {askingReason && (
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">
            {current === "bounced"
              ? "Su email rebotaba: si sigue sin existir, los envíos vuelven a rebotar y eso perjudica que tus emails lleguen a todos."
              : "Marcó un email como spam: volver a escribirle sin que lo pida puede hacer que tus emails terminen en spam."}
          </p>
          <label htmlFor={`reason-${contactId}`} className="mt-2 block">
            ¿Por qué lo volvés a suscribir?
          </label>
          <textarea
            id={`reason-${contactId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Por ejemplo: me confirmó por teléfono que el buzón ya anda."
          />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending || !reason.trim()} onClick={() => save("subscribed", reason)} className={`${button} bg-background`}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Volver a suscribir
            </button>
            <button type="button" onClick={() => setAskingReason(false)} className={button}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <ActionError message={error} />
    </div>
  );
}
