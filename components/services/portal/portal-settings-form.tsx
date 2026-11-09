"use client";
// @plantilla-quitar(servicios)

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Eye, Loader2, RefreshCw } from "lucide-react";
import { loadPortalSenderDomains, savePortalSettings } from "@/lib/actions/portal-admin";
import { validateWorkspacePortalSettings } from "@/lib/portal-admin/settings";
import { PORTAL_TEXT_VARIABLES, variablesToChips } from "@/lib/portal-admin/invite-variables";
import { composeAddress, splitAddress, validateSenderLocal } from "@/lib/email/senders";
import { bodyToEditorHtml } from "@/lib/editor/email-body";
import { portalInviteEmail } from "@/lib/email/templates";
import { countryFromTimezone } from "@/lib/scheduling/phone-countries";
import type { Brand } from "@/lib/brand";
import { fieldInput } from "@/components/content/dialog";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { VariableMenu } from "@/components/editor/variable-menu";
import { PhoneInput } from "@/components/ui/phone-input";

interface PortalSettingsValue {
  host?: string | null;
  from_email?: string | null;
  welcome?: { home_text?: string; invite_subject?: string; invite_body?: string };
  login?: { password_allowed?: boolean };
  support_whatsapp?: string | null;
}

/** Para la vista previa: un cliente de ejemplo (nunca datos reales). */
const PREVIEW_STUDENT = "Ana Pérez";

/** La nota de lo que se guarda pero el portal todavía no muestra (decisión del 8/11/2026). */
function NotYetNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Ajustes del portal (F43): la dirección (un dato, nunca en el código), desde qué email salen las invitaciones (un
 * dominio verificado del Resend del negocio), el email de invitación (con formato, variables y vista previa), el
 * texto de inicio del portal, cómo entran y el WhatsApp de soporte. Valida con la gemela antes de mandar; las
 * extensiones no se ven ni se tocan.
 */
export function PortalSettingsForm({
  initial,
  rev: initialRev,
  canEdit,
  workspaceName,
  brand,
  timeZone,
}: {
  initial: PortalSettingsValue;
  rev: number;
  canEdit: boolean;
  workspaceName: string;
  brand: Brand;
  timeZone: string | null;
}) {
  const savedFrom = splitAddress(initial.from_email);
  const [host, setHost] = useState(initial.host ?? "");
  const [ownSender, setOwnSender] = useState(Boolean(savedFrom));
  const [fromLocal, setFromLocal] = useState(savedFrom?.local ?? "portal");
  const [fromDomain, setFromDomain] = useState(savedFrom?.domain ?? "");
  const [home, setHome] = useState(() => variablesToChips(bodyToEditorHtml(initial.welcome?.home_text ?? "")));
  const [subject, setSubject] = useState(initial.welcome?.invite_subject ?? "");
  const [body, setBody] = useState(() => variablesToChips(bodyToEditorHtml(initial.welcome?.invite_body ?? "")));
  const [password, setPassword] = useState(initial.login?.password_allowed !== false);
  const [whatsapp, setWhatsapp] = useState(initial.support_whatsapp ?? "");
  const [rev, setRev] = useState(initialRev);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const subjectRef = useRef<HTMLInputElement>(null);

  // Los dominios verificados del Resend del negocio (solo quien puede editar los pide).
  const [domains, setDomains] = useState<string[] | null>(null);
  const [domainsNote, setDomainsNote] = useState<string | null>(null);
  const [loadingDomains, startDomains] = useTransition();
  function fetchDomains(refresh: boolean) {
    startDomains(async () => {
      const res = await loadPortalSenderDomains({ refresh });
      if (res.ok) {
        setDomains(res.domains);
        setDomainsNote(res.domains.length === 0 ? "Tu Resend no tiene ningún dominio verificado todavía. Verificalo en resend.com/domains y tocá «Actualizar»." : null);
      } else {
        setDomains([]);
        setDomainsNote(res.message);
      }
    });
  }
  useEffect(() => {
    if (canEdit) fetchDomains(false);
    // Solo al abrir la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // El dominio guardado se sigue mostrando aunque hoy no esté en la lista (Resend caído o dejó de estar verificado).
  const domainOptions = [...new Set([...(domains ?? []), ...(savedFrom ? [savedFrom.domain] : [])])].sort((a, b) => a.localeCompare(b));
  const savedNotVerified = Boolean(savedFrom && domains && domains.length > 0 && !domains.includes(savedFrom.domain));

  function insertInSubject(name: string) {
    const token = `{{${name}}}`;
    const el = subjectRef.current;
    const at = el?.selectionStart ?? subject.length;
    const end = el?.selectionEnd ?? at;
    const next = subject.slice(0, at) + token + subject.slice(end);
    setSubject(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  function save() {
    let from: string | null = null;
    if (ownSender) {
      const localProblem = validateSenderLocal(fromLocal);
      if (localProblem) return setMsg({ kind: "error", text: localProblem });
      if (!fromDomain) return setMsg({ kind: "error", text: "Elegí el dominio de «Enviar desde», o usá el remitente del negocio." });
      from = composeAddress(fromLocal, fromDomain);
    }
    const patch: Record<string, unknown> = {
      v: 1,
      host: host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") || null,
      from_email: from,
      welcome: { home_text: home, invite_subject: subject, invite_body: body },
      login: { password_allowed: password },
      support_whatsapp: whatsapp || null,
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

  const previewEmail = preview
    ? portalInviteEmail({
        workspaceName,
        // Un link de ejemplo: el de verdad lleva un código que vence en 7 días.
        inviteUrl: `https://${host.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") || "portal.tunegocio.com"}/entrar/invitacion/ejemplo`,
        studentName: PREVIEW_STUDENT,
        subject,
        body,
        brand,
      })
    : null;

  return (
    <div className="max-w-3xl space-y-6">
      <Section title="Dirección del portal" description="Dónde entran tus clientes. Los links de invitación y de «Ver como estudiante» salen de esta dirección.">
        <label className="block text-xs text-muted-foreground">
          Dirección (sin https://)
          <input className={fieldInput} value={host} disabled={!canEdit} onChange={(e) => setHost(e.target.value)} placeholder="portal.tunegocio.com" />
        </label>
        <p className="text-xs text-muted-foreground">
          Apuntá esa dirección a la app del portal en Railway. Para una dirección raíz (sin «www» ni subdominio), tu proveedor de DNS tiene que permitir un CNAME en la raíz.
        </p>
      </Section>

      <Section title="Remitente de las invitaciones" description="Desde qué email le llega la invitación al cliente.">
        <fieldset className="space-y-2" disabled={!canEdit}>
          <legend className="sr-only">Enviar desde</legend>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="radio" name="portal-sender" checked={!ownSender} onChange={() => setOwnSender(false)} />
            El remitente del negocio <span className="text-xs text-muted-foreground">(el de Ajustes → Integraciones → Resend)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="radio" name="portal-sender" checked={ownSender} onChange={() => setOwnSender(true)} />
            Una dirección propia del portal
          </label>
        </fieldset>
        {ownSender && (
          <div className="space-y-2 pl-6">
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="portal-from-local">
                Lo que va antes del @
              </label>
              <input
                id="portal-from-local"
                className="h-9 w-40 rounded-lg border border-border bg-background px-3 text-sm"
                value={fromLocal}
                disabled={!canEdit}
                onChange={(e) => setFromLocal(e.target.value)}
                placeholder="portal"
              />
              <span className="text-sm text-muted-foreground">@</span>
              <label className="sr-only" htmlFor="portal-from-domain">
                Dominio
              </label>
              <select
                id="portal-from-domain"
                className="h-9 min-w-48 rounded-lg border border-border bg-background px-2 text-sm"
                value={fromDomain}
                disabled={!canEdit || (domainOptions.length === 0 && !loadingDomains)}
                onChange={(e) => setFromDomain(e.target.value)}
              >
                <option value="">{loadingDomains && domains === null ? "Cargando dominios…" : "Elegí un dominio"}</option>
                {domainOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                    {savedFrom?.domain === d && domains && !domains.includes(d) ? " (sin verificar)" : ""}
                  </option>
                ))}
              </select>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => fetchDomains(true)}
                  disabled={loadingDomains}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60"
                >
                  {loadingDomains ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  Actualizar
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Solo aparecen los dominios verificados en tu Resend: con uno sin verificar la invitación no saldría.</p>
            {domainsNote && <p className="text-xs text-warn">{domainsNote}</p>}
            {savedNotVerified && <p className="text-xs text-destructive">El dominio guardado ({savedFrom?.domain}) ya no está verificado en Resend: elegí otro o usá el remitente del negocio.</p>}
          </div>
        )}
      </Section>

      <Section
        title="Email de invitación"
        description="Lo recibe un cliente cuando lo invitás al portal desde su ficha (Clientes → el cliente → Portal → Invitar). Abajo del texto va siempre el botón «Entrar al portal»."
      >
        <div className="space-y-1">
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="portal-invite-subject" className="text-xs text-muted-foreground">
              Asunto (vacío = «Tu acceso al portal de {workspaceName}»)
            </label>
            {canEdit && <VariableMenu variables={PORTAL_TEXT_VARIABLES} onPick={insertInSubject} align="end" />}
          </div>
          <input id="portal-invite-subject" ref={subjectRef} className={fieldInput} value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1">
          <span className="block text-xs text-muted-foreground">Mensaje (vacío = un saludo con el nombre del cliente)</span>
          <RichTextEditor id="portal-invite-body" label="Mensaje de la invitación" value={body} onChange={setBody} variables={PORTAL_TEXT_VARIABLES} disabled={!canEdit} minHeight={120} />
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            aria-expanded={preview}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent"
          >
            <Eye className="h-4 w-4" aria-hidden /> {preview ? "Ocultar vista previa" : "Ver vista previa"}
          </button>
          {previewEmail && (
            <div className="overflow-hidden rounded-lg border border-border">
              <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Asunto: <span className="text-foreground">{previewEmail.subject}</span> · con un cliente de ejemplo ({PREVIEW_STUDENT})
              </p>
              {/* El email se dibuja aislado: sin scripts y sin estilos de la app. */}
              <iframe title="Vista previa del email de invitación" sandbox="" srcDoc={previewEmail.html} className="h-[520px] w-full bg-white" />
            </div>
          )}
        </div>
      </Section>

      <Section title="Pantalla de inicio del portal" description="El mensaje de bienvenida que ve el cliente arriba de todo al entrar a su portal.">
        <RichTextEditor id="portal-home-text" label="Texto de inicio del portal" value={home} onChange={setHome} variables={PORTAL_TEXT_VARIABLES} disabled={!canEdit} minHeight={100} />
        <NotYetNote>El portal todavía no muestra este texto. Lo que cargues ahora queda guardado y aparece cuando esté listo.</NotYetNote>
      </Section>

      <Section title="Cómo entran y soporte" description="Cómo inician sesión tus clientes y a qué WhatsApp escriben si necesitan ayuda.">
        <p className="text-xs text-muted-foreground">Siempre pueden entrar con un código que les llega por email.</p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={password} disabled={!canEdit} onChange={(e) => setPassword(e.target.checked)} /> También con contraseña
        </label>
        <div className="space-y-1">
          <label htmlFor="portal-support-whatsapp" className="block text-xs text-muted-foreground">
            WhatsApp de soporte
          </label>
          <PhoneInput
            id="portal-support-whatsapp"
            label="WhatsApp de soporte"
            value={whatsapp}
            onChange={setWhatsapp}
            disabled={!canEdit}
            defaultCountry={countryFromTimezone(timeZone)}
          />
        </div>
        <NotYetNote>El portal todavía no usa «También con contraseña» ni el WhatsApp de soporte. Lo que elijas queda guardado y se aplica cuando esté listo.</NotYetNote>
      </Section>

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
