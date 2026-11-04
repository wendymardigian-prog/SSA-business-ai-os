"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CircleDashed, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { CopyableUrl } from "./credentials-form";
import { loadResendDomains } from "@/lib/actions/resend-senders";
import {
  checkResendConnectionAction,
  clearResendWebhookSecretAction,
  connectResendWebhookAction,
  saveResendReceivingAction,
  saveResendWebhookSecretAction,
} from "@/lib/actions/resend-connection";
import { DEFAULT_RECEIVING_LOCAL, primaryAddress, type ResendPanelData } from "@/lib/email/resend-config";
import { RESEND_EVENT_LABELS, RESEND_REQUIRED_EVENTS, RESEND_WEBHOOK_EVENTS_LIST } from "@/lib/email/resend-events";
import { resendChecklist, timeAgo, type CheckItem, type LiveResult } from "@/lib/email/resend-status";
import { receivingState, RECEIVING_STATE_LABELS, type ResendDomain } from "@/lib/email/senders";

const RECEIVING_DOCS = "https://resend.com/docs/dashboard/receiving/custom-domains";
const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";
const button =
  "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50";
const primaryButton =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

/**
 * La tarjeta Resend (conexion de Resend, R1): una sola pantalla con la lista de estado arriba y cuatro secciones —
 * Conexion (la API key, el formulario de siempre), Remitentes (E8, sin cambios), Webhook y Recepcion de emails.
 *
 * La key y el secreto nunca llegan aca: el servidor dice si existen y que contesto Resend.
 */
export function ResendCard({
  panel,
  connected,
  fromEmail,
  readOnly,
  connection,
  senders,
}: {
  panel: ResendPanelData;
  connected: boolean;
  fromEmail: string | null;
  readOnly: boolean;
  /** El formulario de la API key (CredentialsForm). */
  connection: ReactNode;
  /** Los remitentes (ResendSendersForm). */
  senders: ReactNode;
}) {
  const [domains, setDomains] = useState<ResendDomain[] | null>(null);
  const [domainNotice, setDomainNotice] = useState<string | null>(null);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probing, startProbe] = useTransition();
  const canManage = connected && !readOnly;

  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    void loadResendDomains({ refresh: false }).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setDomains(result.domains);
        setDomainNotice(null);
      } else {
        setDomains(null);
        setDomainNotice("message" in result ? result.message : result.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [canManage]);

  function probe() {
    setProbeError(null);
    startProbe(async () => {
      const result = await checkResendConnectionAction();
      if (!result.ok) {
        setProbeError(result.error);
        return;
      }
      setLive(result.live);
      setDomains(result.domains);
    });
  }

  const access = live?.key.ok ? live.key.access : panel.state.access;
  const items = useMemo(
    () => resendChecklist({ connected, state: panel.state, fromEmail, domains, secretSaved: panel.secretSaved, lastEventAt: panel.lastEventAt, live }),
    [connected, panel, fromEmail, domains, live],
  );

  return (
    <div className="max-w-xl space-y-6">
      <Checklist items={items} onProbe={canManage ? probe : null} probing={probing} error={probeError} />

      <section>
        <SectionTitle title="Conexión" />
        {connected && (
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
            <Check className="h-3 w-3" aria-hidden />
            {access === "full" ? "Conectada · acceso completo" : access === "sending" ? "Conectada · solo envío" : "Conectada"}
          </p>
        )}
        {connection}
      </section>

      {senders}

      <WebhookSection panel={panel} connected={connected} readOnly={readOnly} access={access} />

      <ReceivingSection panel={panel} connected={connected} readOnly={readOnly} domains={domains} domainNotice={domainNotice} />
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Checklist({ items, onProbe, probing, error }: { items: CheckItem[]; onProbe: (() => void) | null; probing: boolean; error: string | null }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Estado</h3>
        {onProbe && (
          <button type="button" onClick={onProbe} disabled={probing} className={button}>
            {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Probar
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">«Probar» consulta a Resend la key, el webhook y los dominios. Solo mira: no cambia nada ni manda emails.</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex gap-2 text-xs">
            <StatusIcon status={item.status} />
            <div className="min-w-0">
              <p className="font-medium">{item.title}</p>
              {item.detail && <p className="mt-0.5 text-muted-foreground">{item.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

function StatusIcon({ status }: { status: CheckItem["status"] }) {
  if (status === "ok") return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Listo" />;
  if (status === "fail") return <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-label="Falta" />;
  return <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Opcional o sin comprobar" />;
}

function Feedback({ message, error, warnings = [] }: { message: string | null; error: string | null; warnings?: string[] }) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {message && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{message}</p>}
      {warnings.map((w) => (
        <p key={w} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {w}
        </p>
      ))}
    </>
  );
}

function WebhookSection({
  panel,
  connected,
  readOnly,
  access,
}: {
  panel: ResendPanelData;
  connected: boolean;
  readOnly: boolean;
  access: "full" | "sending" | null;
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const { webhook } = panel.state;

  // En rojo solo lo imprescindible (recepcion, rebotes, quejas); los de resultados se sugieren aparte.
  const missing = RESEND_REQUIRED_EVENTS.filter((e) => !webhook.events.includes(e));
  const optionalMissing = RESEND_WEBHOOK_EVENTS_LIST.filter((e) => !webhook.events.includes(e) && !(RESEND_REQUIRED_EVENTS as readonly string[]).includes(e));
  const present = webhook.events.length > 0 ? RESEND_WEBHOOK_EVENTS_LIST.filter((e) => webhook.events.includes(e)).length : RESEND_WEBHOOK_EVENTS_LIST.length;
  const status = webhook.needsSecret
    ? "Falta pegar el Signing secret"
    : panel.secretSaved && webhook.id && missing.length > 0
      ? `Le faltan eventos: ${missing.join(", ")}`
      : panel.secretSaved
        ? `Webhook conectado · ${present} eventos${panel.lastEventAt ? ` · último aviso recibido ${timeAgo(panel.lastEventAt)}` : ""}`
        : "Falta conectar";
  const optionalHint =
    panel.secretSaved && webhook.id && missing.length === 0 && optionalMissing.length > 0 && webhook.events.length > 0
      ? "Sumá las entregas, aperturas y clics para ver los resultados de cada envío: tocá «Actualizar webhook»."
      : null;
  const manualOpen = showManual || access === "sending" || webhook.needsSecret;
  const canAct = connected && !readOnly;

  function run(fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) {
    setMessage(null);
    setError(null);
    startBusy(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? null);
      after?.();
      router.refresh();
    });
  }

  return (
    <section className="border-t border-border pt-6">
      <SectionTitle
        title="Webhook (rebotes, quejas y emails entrantes)"
        subtitle="Por acá Resend le avisa a SSA cuando un email rebota, alguien lo marca como spam o te escriben. SSA solo crea y administra su propio webhook: nunca toca otros de tu cuenta."
      />
      <p className="mb-3 text-xs font-medium">{status}</p>
      {optionalHint ? <p className="-mt-2 mb-3 text-xs text-muted-foreground">{optionalHint}</p> : null}

      {panel.webhookUrl ? (
        <CopyableUrl label="URL del webhook" url={panel.webhookUrl} />
      ) : (
        <p className="text-xs text-muted-foreground">La app no tiene un dominio público configurado (NEXT_PUBLIC_APP_URL): hasta entonces no hay una URL a la que Resend pueda llegar.</p>
      )}

      <div className="mt-3">
        <p className="text-xs font-medium">Eventos que usa SSA</p>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {RESEND_WEBHOOK_EVENTS_LIST.map((e) => (
            <li key={e}>
              <code className="text-foreground">{e}</code> — {RESEND_EVENT_LABELS[e]}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run(connectResendWebhookAction)}
          disabled={!canAct || busy || access === "sending" || !panel.webhookUrl}
          className={primaryButton}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {webhook.id ? "Actualizar webhook" : "Conectar webhook automáticamente"}
        </button>
        {!manualOpen && (
          <button type="button" onClick={() => setShowManual(true)} className="text-xs font-medium text-primary-ink hover:underline">
            Prefiero crearlo a mano
          </button>
        )}
      </div>
      {!connected && <p className="mt-2 text-xs text-muted-foreground">Guardá primero la API key de Resend.</p>}

      <div className="mt-4 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium">Secreto del webhook</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Con él SSA comprueba que el aviso viene de Resend. Se obtiene solo al conectar el webhook.</p>
        {panel.secretSaved && !replacing ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" aria-hidden />
              Guardado{webhook.secretSavedAt ? ` el ${new Date(webhook.secretSavedAt).toLocaleDateString("es")}` : ""}
            </span>
            {!readOnly && (
              <>
                <button type="button" onClick={() => setReplacing(true)} className="font-medium text-primary-ink hover:underline">
                  Reemplazar
                </button>
                <button
                  type="button"
                  onClick={() => run(clearResendWebhookSecretAction)}
                  disabled={busy}
                  className="font-medium text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
                >
                  Quitar secreto
                </button>
              </>
            )}
          </div>
        ) : (
          manualOpen || replacing ? (
            <div className="mt-2">
              <label htmlFor="resend-webhook-secret" className="text-xs font-medium">
                Signing secret
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="resend-webhook-secret"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="whsec_…"
                  className={input}
                  disabled={readOnly}
                />
                <button
                  type="button"
                  onClick={() => run(() => saveResendWebhookSecretAction({ secret }), () => { setSecret(""); setReplacing(false); })}
                  disabled={readOnly || busy || !secret.trim()}
                  className={button}
                >
                  Guardar
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Todavía no hay secreto guardado.</p>
          )
        )}
      </div>

      {manualOpen && (
        <div className="mt-4 text-xs">
          <p className="font-medium">Crearlo a mano en Resend</p>
          {access === "sending" && (
            <p className="mt-1 text-muted-foreground">Tu API key es de «solo envío»: no deja crear el webhook desde acá.</p>
          )}
          {webhook.needsSecret && (
            <p className="mt-1 text-muted-foreground">Ya hay un webhook de SSA creado a mano: pegá su Signing secret arriba, o borralo en Resend y tocá «Conectar» de nuevo.</p>
          )}
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>
              Entrá a{" "}
              <a href="https://resend.com/webhooks" target="_blank" rel="noreferrer" className="font-medium text-primary-ink hover:underline">
                resend.com/webhooks
              </a>{" "}
              y tocá «Add Webhook».
            </li>
            <li>En «Endpoint URL» pegá la URL de arriba (con el «?w=…» del final).</li>
            <li>En «Events» marcá: {RESEND_WEBHOOK_EVENTS_LIST.join(", ")}.</li>
            <li>Guardalo, copiá el «Signing secret» (empieza con whsec_) y pegalo en «Secreto del webhook».</li>
          </ol>
        </div>
      )}

      <Feedback message={message} error={error} />
    </section>
  );
}

function ReceivingSection({
  panel,
  connected,
  readOnly,
  domains,
  domainNotice,
}: {
  panel: ResendPanelData;
  connected: boolean;
  readOnly: boolean;
  domains: ResendDomain[] | null;
  domainNotice: string | null;
}) {
  const router = useRouter();
  const { receiving } = panel.state;
  const [enabled, setEnabled] = useState(receiving.enabled);
  const [domain, setDomain] = useState(receiving.domain ?? "");
  const [local, setLocal] = useState(receiving.local || DEFAULT_RECEIVING_LOCAL);
  const [busy, startBusy] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const canAct = connected && !readOnly;

  const selected = domains?.find((d) => d.name === domain) ?? null;
  const address = primaryAddress({ enabled, domain: domain.trim().toLowerCase() || null, local: local.trim().toLowerCase() || DEFAULT_RECEIVING_LOCAL });

  function save() {
    setMessage(null);
    setError(null);
    setWarnings([]);
    startBusy(async () => {
      const result = await saveResendReceivingAction({ enabled, domain, local });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      setWarnings(result.warnings);
      router.refresh();
    });
  }

  return (
    <section className="border-t border-border pt-6">
      <SectionTitle
        title="Recepción de emails (opcional)"
        subtitle="Los emails que te escriban a cualquier dirección de este dominio entran a la bandeja como conversaciones."
      />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canAct} className="h-4 w-4" />
        Recibir emails en la bandeja
      </label>

      {enabled && (
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="receiving-domain" className="text-xs font-medium">
              Dominio de recepción
            </label>
            {domains ? (
              <select id="receiving-domain" value={domain} onChange={(e) => setDomain(e.target.value)} className={`${input} mt-1`} disabled={!canAct}>
                <option value="">Elegí un dominio</option>
                {domains.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name} — {RECEIVING_STATE_LABELS[receivingState(d)]}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input id="receiving-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="tudominio.com" className={`${input} mt-1`} disabled={!canAct} />
                {domainNotice && <p className="mt-1 text-[11px] text-muted-foreground">{domainNotice}</p>}
              </>
            )}
            {selected && (
              <p className={`mt-1 text-[11px] ${receivingState(selected) === "active" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200"}`}>
                {RECEIVING_STATE_LABELS[receivingState(selected)]}
              </p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Resend no dice si el MX ya está verificado registro por registro: «Recepción activa» es Receiving prendido y el dominio verificado.{" "}
              <a href={RECEIVING_DOCS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary-ink hover:underline">
                Cómo activar Receiving en Resend
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </p>
          </div>

          <div>
            <label htmlFor="receiving-local" className="text-xs font-medium">
              Dirección principal
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input id="receiving-local" value={local} onChange={(e) => setLocal(e.target.value)} placeholder={DEFAULT_RECEIVING_LOCAL} className={`${input} max-w-[12rem]`} disabled={!canAct} />
              <span className="text-sm text-muted-foreground">@{domain || "tudominio.com"}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Desde acá salen los emails que escribís primero desde la bandeja. Las respuestas salen desde la misma dirección a la que te escribieron
              {address ? ` (si te escriben a soporte@${domain}, contestás desde soporte@${domain})` : ""}.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4">
        <button type="button" onClick={save} disabled={!canAct || busy || (enabled && !domain.trim())} className={primaryButton}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar recepción
        </button>
      </div>
      <Feedback message={message} error={error} warnings={warnings} />
    </section>
  );
}
