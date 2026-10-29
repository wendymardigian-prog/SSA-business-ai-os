"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, AlertTriangle, Check } from "lucide-react";
import { loadResendDomains, saveResendSenders } from "@/lib/actions/resend-senders";
import {
  composeAddress,
  domainStatusLabel,
  isVerifiedDomain,
  senderParts,
  unverifiedSenderWarning,
  validateSenderLocal,
  type ResendDomain,
  type ResendSenderConfig,
} from "@/lib/email/senders";

/**
 * Los remitentes de Resend (suscripcion a emails, E8): se escribe lo de antes del @
 * y se elige el dominio de la lista que trae Resend (solo los verificados). Si la
 * key no deja listar (las keys "solo envio"), el dominio se escribe a mano. La key
 * nunca llega aca: el servidor la lee y devuelve solo nombres y estados.
 */
export function ResendSendersForm({ config, connected }: { config: Record<string, string>; connected: boolean }) {
  const router = useRouter();
  const current = config as ResendSenderConfig;
  const important = senderParts(current, "important");
  const marketing = senderParts(current, "marketing");

  const [fromLocal, setFromLocal] = useState(important.local);
  const [fromDomain, setFromDomain] = useState(important.domain);
  const [fromName, setFromName] = useState(current.from_name ?? "");
  const [mLocal, setMLocal] = useState(marketing.local);
  const [mDomain, setMDomain] = useState(marketing.domain);
  const [replyTo, setReplyTo] = useState(current.reply_to ?? "");

  const [domains, setDomains] = useState<ResendDomain[] | null>(null);
  const [domainNotice, setDomainNotice] = useState<string | null>(null);
  const [loadingDomains, startDomains] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function fetchDomains(refresh: boolean) {
    startDomains(async () => {
      const result = await loadResendDomains({ refresh });
      if (result.ok) {
        setDomains(result.domains);
        setDomainNotice(null);
      } else {
        setDomains(null);
        setDomainNotice("message" in result ? result.message : result.error);
      }
    });
  }

  useEffect(() => {
    if (connected) fetchDomains(false);
    // Solo al abrir: "Actualizar dominios" vuelve a pedirlos.
  }, [connected]);

  const warning = unverifiedSenderWarning(current.from_email, domains);

  function save() {
    setError(null);
    setSaved(false);
    startSave(async () => {
      const result = await saveResendSenders({ fromLocal, fromDomain, fromName, marketingLocal: mLocal, marketingDomain: mDomain, replyTo });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    });
  }

  const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";

  return (
    <section className="mt-6 max-w-xl border-t border-border pt-6">
      <h3 className="text-sm font-semibold">Remitentes</h3>
      <p className="mt-1 text-xs text-muted-foreground">Desde qué dirección salen tus emails. El dominio tiene que estar verificado en Resend.</p>

      {!connected && <p className="mt-3 text-xs text-muted-foreground">Guardá primero la API key de Resend: con ella se traen tus dominios.</p>}

      {warning && (
        <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      )}

      {domainNotice && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {domainNotice}
        </p>
      )}

      <SenderRow
        id="sender-important"
        label="Remitente de emails importantes"
        hint="Agenda, contratos, invitaciones y avisos."
        local={fromLocal}
        domain={fromDomain}
        domains={domains}
        onLocal={setFromLocal}
        onDomain={setFromDomain}
        inputClass={input}
        disabled={!connected}
      />

      <SenderRow
        id="sender-marketing"
        label="Remitente de marketing (opcional)"
        hint="Recomendado: un subdominio aparte (ej. news.tudominio.com) para que un envío de marketing no afecte a los emails importantes. Vacío: sale desde el de importantes."
        local={mLocal}
        domain={mDomain}
        domains={domains}
        onLocal={setMLocal}
        onDomain={setMDomain}
        inputClass={input}
        disabled={!connected}
        optional
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sender-name" className="text-xs font-medium">
            Nombre del remitente <span className="text-muted-foreground">(opcional)</span>
          </label>
          <input id="sender-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Tu Negocio" className={`${input} mt-1`} disabled={!connected} />
        </div>
        <div>
          <label htmlFor="sender-reply-to" className="text-xs font-medium">
            Responder a <span className="text-muted-foreground">(opcional)</span>
          </label>
          <input id="sender-reply-to" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="hola@tudominio.com" className={`${input} mt-1`} disabled={!connected} />
          <p className="mt-1 text-[11px] text-muted-foreground">Una dirección que reciba las respuestas.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !connected}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar remitentes
        </button>
        <button
          type="button"
          onClick={() => fetchDomains(true)}
          disabled={loadingDomains || !connected}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingDomains ? "animate-spin" : ""}`} />
          Actualizar dominios
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <Check className="h-4 w-4" /> Guardado
          </span>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

function SenderRow({
  id, label, hint, local, domain, domains, onLocal, onDomain, inputClass, disabled, optional = false,
}: {
  id: string;
  label: string;
  hint: string;
  local: string;
  domain: string;
  domains: ResendDomain[] | null;
  onLocal: (v: string) => void;
  onDomain: (v: string) => void;
  inputClass: string;
  disabled: boolean;
  optional?: boolean;
}) {
  const localError = local.trim() ? validateSenderLocal(local) : null;
  const preview = local.trim() && domain.trim() && !localError ? composeAddress(local, domain) : null;
  const knownDomain = domains?.some((d) => d.name === domain.toLowerCase());

  return (
    <div className="mt-4">
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <input
          id={`${id}-local`}
          aria-label={`${label}: lo que va antes del @`}
          value={local}
          onChange={(e) => onLocal(e.target.value)}
          placeholder="hola"
          className={`${inputClass} max-w-[11rem]`}
          disabled={disabled}
        />
        <span className="text-sm text-muted-foreground">@</span>
        {domains ? (
          <select
            id={`${id}-domain`}
            aria-label={`${label}: dominio`}
            value={knownDomain ? domain.toLowerCase() : ""}
            onChange={(e) => onDomain(e.target.value)}
            className={`${inputClass} max-w-[16rem]`}
            disabled={disabled}
          >
            <option value="">{optional ? "Sin remitente propio" : "Elegí un dominio"}</option>
            {domains.map((d) => (
              <option key={d.name} value={d.name} disabled={!isVerifiedDomain(d)}>
                {d.name}
                {isVerifiedDomain(d) ? "" : ` (${domainStatusLabel(d.status)})`}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${id}-domain`}
            aria-label={`${label}: dominio`}
            value={domain}
            onChange={(e) => onDomain(e.target.value)}
            placeholder="mail.tudominio.com"
            className={`${inputClass} max-w-[16rem]`}
            disabled={disabled}
          />
        )}
      </div>
      {preview && <p className="mt-1 text-xs text-muted-foreground">Sale como <span className="font-medium text-foreground">{preview}</span></p>}
      {localError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{localError}</p>}
      {domains && domains.some((d) => !isVerifiedDomain(d)) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Los dominios sin verificar no se pueden elegir.{" "}
          <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="underline">
            Verificalos en resend.com/domains
          </a>
          .
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
