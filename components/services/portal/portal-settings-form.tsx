"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { savePortalSettings } from "@/lib/actions/portal-admin";
import { validateWorkspacePortalSettings } from "@/lib/portal-admin/settings";
import { fieldInput } from "@/components/content/dialog";

interface PortalSettingsValue {
  host?: string | null;
  from_email?: string | null;
  welcome?: { home_text?: string; invite_subject?: string; invite_body?: string };
  login?: { password_allowed?: boolean };
  support_whatsapp?: string | null;
}

/**
 * Ajustes del portal (F43): la dirección (un dato, nunca en el código), el remitente, la bienvenida y la invitación,
 * cómo entran y el WhatsApp de soporte. Valida con la gemela antes de mandar; las extensiones no se ven ni se tocan.
 */
export function PortalSettingsForm({ initial, rev: initialRev, canEdit }: { initial: PortalSettingsValue; rev: number; canEdit: boolean }) {
  const [host, setHost] = useState(initial.host ?? "");
  const [from, setFrom] = useState(initial.from_email ?? "");
  const [home, setHome] = useState(initial.welcome?.home_text ?? "");
  const [subject, setSubject] = useState(initial.welcome?.invite_subject ?? "");
  const [body, setBody] = useState(initial.welcome?.invite_body ?? "");
  const [password, setPassword] = useState(initial.login?.password_allowed !== false);
  const [whatsapp, setWhatsapp] = useState(initial.support_whatsapp ?? "");
  const [rev, setRev] = useState(initialRev);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const patch: Record<string, unknown> = {
      v: 1,
      host: host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") || null,
      from_email: from.trim() || null,
      welcome: { home_text: home, invite_subject: subject, invite_body: body },
      login: { password_allowed: password },
      support_whatsapp: whatsapp.replace(/\s/g, "") || null,
    };
    const problems = validateWorkspacePortalSettings(patch);
    if (problems.length) return setMsg({ kind: "error", text: problems.join(". ") });
    setMsg(null);
    start(async () => {
      const res = await savePortalSettings(patch, rev);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      if (res.data.status === "ok") {
        setRev(res.data.rev ?? rev + 1);
        setMsg({ kind: "ok", text: "Guardado." });
      } else if (res.data.status === "conflict") {
        setRev(res.data.rev ?? rev);
        setMsg({ kind: "error", text: "Alguien cambió los ajustes mientras los editabas. Recargá la página para ver lo último." });
      } else setMsg({ kind: "error", text: (res.data.problems ?? []).join(". ") });
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Dirección del portal</legend>
        <label className="block text-xs text-muted-foreground">
          Dirección (sin https://)
          <input className={fieldInput} value={host} disabled={!canEdit} onChange={(e) => setHost(e.target.value)} placeholder="portal.tunegocio.com" />
        </label>
        <p className="text-xs text-muted-foreground">
          Apuntá esa dirección a la app del portal en Railway. Para una dirección raíz (sin «www» ni subdominio), tu proveedor de DNS tiene que permitir un CNAME en la raíz. Los
          links de invitación y de «Ver como estudiante» salen de esta dirección.
        </p>
        <label className="block text-xs text-muted-foreground">
          Enviar desde
          <input className={fieldInput} type="email" value={from} disabled={!canEdit} onChange={(e) => setFrom(e.target.value)} placeholder="portal@tunegocio.com" />
        </label>
        <p className="text-xs text-muted-foreground">Necesita el dominio verificado en tu Resend. Mientras tanto se usa el remitente que ya tiene el negocio.</p>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Bienvenida e invitación</legend>
        <label className="block text-xs text-muted-foreground">
          Texto del inicio
          <textarea className={fieldInput} rows={3} value={home} disabled={!canEdit} onChange={(e) => setHome(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Asunto de la invitación (vacío = «Tu acceso al portal de …»)
          <input className={fieldInput} value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Texto de la invitación. Podés usar {"{nombre}"}.
          <textarea className={fieldInput} rows={4} value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Cómo entran y soporte</legend>
        <p className="text-xs text-muted-foreground">Siempre pueden entrar con un código por email.</p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={password} disabled={!canEdit} onChange={(e) => setPassword(e.target.checked)} /> También con contraseña
        </label>
        <label className="block text-xs text-muted-foreground">
          WhatsApp de soporte (con + y código de país)
          <input className={fieldInput} value={whatsapp} disabled={!canEdit} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+506…" />
        </label>
      </fieldset>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {pending ? "Guardando…" : "Guardar"}
          </button>
          {msg && (
            <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
              {msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
