"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPreviewPass, inviteToPortal, reactivatePortalAccount, suspendPortalAccount, type InviteOutcome } from "@/lib/actions/portal-admin";
import type { PortalAccountView } from "@/lib/portal-admin/load";
import { fieldInput } from "@/components/content/dialog";

const STATUS_LABEL: Record<PortalAccountView["status"], string> = { invited: "Invitado", active: "Activa", suspended: "Suspendida" };

const OUTCOME_TEXT: Record<InviteOutcome, string> = {
  sent: "Invitación enviada. El link vence en 7 días.",
  no_host: "Configurá la dirección del portal en Portal › Ajustes del portal.",
  no_email: "El contacto no tiene email: cargalo en su ficha para invitarlo.",
  email_conflict: "Otro contacto ya usa ese email en el portal. Fusioná los contactos.",
  suspended: "La cuenta está suspendida: reactivala antes de invitar.",
  rate_limited: "Ya mandaste una invitación hace un momento. Probá de nuevo en un rato.",
  email_failed: "No se pudo mandar el email. Probá de nuevo en un rato.",
  email_not_configured: "El negocio no tiene Resend conectado: conectalo en Ajustes › Integraciones.",
};

/**
 * La cuenta del portal del cliente (F41, F42): estado, invitar o reenviar, suspender o reactivar (`portal.accounts`)
 * y «Ver como estudiante» (`portal.view_as`), que abre el portal en solo lectura con un pase de 60 segundos.
 */
export function PortalAccountCard({
  contactId,
  contactName,
  account,
  hasHost,
  canAccounts,
  canViewAs,
}: {
  contactId: string;
  contactName: string;
  account: PortalAccountView | null;
  hasHost: boolean;
  canAccounts: boolean;
  canViewAs: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmView, setConfirmView] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const invite = () =>
    start(async () => {
      const res = await inviteToPortal(contactId);
      setMsg(res.ok ? OUTCOME_TEXT[res.data.outcome] : res.error.message);
      router.refresh();
    });
  const viewAs = () =>
    start(async () => {
      const res = await createPreviewPass(contactId);
      setConfirmView(false);
      if (!res.ok) return setMsg(res.error.message);
      if (!res.data.url) return setMsg(OUTCOME_TEXT.no_host);
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    });
  const suspend = () =>
    start(async () => {
      if (!account) return;
      const res = await suspendPortalAccount(contactId, account.id, reason);
      if (!res.ok) return setMsg(res.error.message);
      setSuspending(false);
      setReason("");
      router.refresh();
    });
  const reactivate = () =>
    start(async () => {
      if (!account) return;
      const res = await reactivatePortalAccount(contactId, account.id);
      if (!res.ok) return setMsg(res.error.message);
      router.refresh();
    });

  return (
    <section aria-labelledby="portal-cuenta" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="portal-cuenta" className="text-sm font-semibold text-foreground">
            Portal
          </h2>
          <p className="text-xs text-muted-foreground">
            {account
              ? `Cuenta ${STATUS_LABEL[account.status].toLowerCase()}${account.lastLoginAt ? ` · último ingreso ${account.lastLoginAt.slice(0, 10).split("-").reverse().join("/")}` : ""}${account.inviteSentAt && account.status === "invited" ? ` · invitado el ${account.inviteSentAt.slice(0, 10).split("-").reverse().join("/")}` : ""}`
              : "Todavía no tiene cuenta: se crea con su primer acceso o al invitarlo."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewAs && (
            <button
              type="button"
              onClick={() => setConfirmView(true)}
              disabled={!hasHost || pending}
              title={hasHost ? undefined : "Configurá la dirección del portal en Ajustes del portal"}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
            >
              Ver como estudiante
            </button>
          )}
          {canAccounts && account?.status !== "suspended" && (
            <button type="button" onClick={invite} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60">
              {account?.inviteSentAt ? "Reenviar invitación" : "Invitar al portal"}
            </button>
          )}
          {canAccounts && account && account.status !== "suspended" && (
            <button type="button" onClick={() => setSuspending(true)} disabled={pending} className="rounded-lg px-3 py-1.5 text-sm text-destructive hover:bg-accent">
              Suspender
            </button>
          )}
          {canAccounts && account?.status === "suspended" && (
            <button type="button" onClick={reactivate} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
              Reactivar
            </button>
          )}
        </div>
      </div>
      {account?.status === "suspended" && account.suspendedReason && <p className="mt-2 text-xs text-muted-foreground">Motivo de la suspensión: {account.suspendedReason}</p>}
      {msg && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {msg}
        </p>
      )}
      {confirmView && (
        <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm text-foreground">Abre el portal de {contactName} en solo lectura por 30 minutos. Queda registrado.</p>
          <div className="flex gap-2">
            <button type="button" onClick={viewAs} disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
              Abrir
            </button>
            <button type="button" onClick={() => setConfirmView(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {suspending && (
        <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
          <label className="block text-xs text-muted-foreground">
            Motivo
            <textarea className={fieldInput} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">Cierra todas sus sesiones abiertas. No toca sus accesos.</p>
          <div className="flex gap-2">
            <button type="button" onClick={suspend} disabled={pending || !reason.trim()} className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-60">
              Suspender
            </button>
            <button type="button" onClick={() => setSuspending(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
