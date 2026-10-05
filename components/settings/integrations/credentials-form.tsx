"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { saveIntegration, disconnectIntegration, countScheduledUses } from "@/lib/actions/integrations";
import { syncSocialAccountsNow } from "@/lib/actions/social-accounts";
import { secretFieldsOf, type ProviderDefinition } from "@/lib/integrations/providers";
import type { IntegrationCardData } from "./types";

/**
 * La pestaña Credenciales del detalle (F3, G5).
 *
 * Era el cuerpo del modal (`IntegrationModal`, ya borrado): los campos, los
 * secretos y la ayuda salen de `ProviderDefinition`. Lo unico que cambio es
 * el envoltorio: antes era un dialogo con overlay, ahora es una seccion de la
 * pagina de detalle.
 *
 * Dos reglas que se ven en la interfaz:
 * - Un secreto ya guardado se muestra como "Guardado ✓ · Reemplazar". El valor
 *   no vuelve del servidor nunca, asi que no hay nada que rellenar.
 * - Desconectar avisa primero cuantas publicaciones programadas dependen de
 *   esta integracion.
 *
 * Zernio no usa `saveIntegration`: `/api/v1/channels/test-key` no solo valida
 * la clave, registra el webhook, sincroniza los canales y trae el historial
 * de la bandeja. Guardarla con la accion generica dejaria la clave en Vault y
 * la bandeja sin canales, que es peor que no guardarla.
 */
export function CredentialsForm({
  provider,
  data,
  webhookUrl,
}: {
  provider: ProviderDefinition;
  data: IntegrationCardData;
  /** URL que hay que pegar en el proveedor, cuando corresponde. */
  webhookUrl?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Avisos que no son error: la sincronización de cuentas dejó algo que saber. */
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [scheduledUses, setScheduledUses] = useState<number | null>(null);

  const fields = secretFieldsOf(provider);
  const stored = new Set(data.storedSecretKeys);

  // Un secreto ya guardado arranca en "no lo toco": solo se manda lo que la
  // persona decide reemplazar.
  const [replacing, setReplacing] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, !stored.has(f.key)])),
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of provider.configFields) {
      initial[field.key] = data.config[field.key] ?? field.defaultValue ?? "";
    }
    return initial;
  });

  const connected = data.status !== "not_connected";

  function submit() {
    setError(null);
    const payload = {
      secrets: Object.fromEntries(
        fields.filter((f) => replacing[f.key]).map((f) => [f.key, secrets[f.key] ?? ""]),
      ),
      config,
    };
    startTransition(async () => {
      const result =
        provider.id === "zernio"
          ? await saveZernio(payload.secrets)
          : await saveIntegration({ providerId: provider.id, ...payload });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWarnings("warnings" in result && result.warnings ? result.warnings : []);
      router.refresh();
    });
  }

  function syncAccounts() {
    setError(null);
    startTransition(async () => {
      const result = await syncSocialAccountsNow();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWarnings(result.warnings);
      router.refresh();
    });
  }

  function askDisconnect() {
    setError(null);
    setConfirmingDisconnect(true);
    void countScheduledUses(provider.id).then(setScheduledUses);
  }

  function confirmDisconnect() {
    startTransition(async () => {
      const result = await disconnectIntegration(provider.id);
      if (!result.ok) {
        setError(result.error);
        setConfirmingDisconnect(false);
        return;
      }
      router.refresh();
      setConfirmingDisconnect(false);
    });
  }

  return (
    <div className="max-w-lg">
      {data.reasons.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          {data.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <div className="space-y-4">
        {fields.map((field) => {
          const isStored = stored.has(field.key);
          const isReplacing = replacing[field.key];
          return (
            <div key={field.key}>
              <label htmlFor={`secret-${field.key}`} className="text-xs font-medium">
                {field.label}
                {!field.required && <span className="text-muted-foreground"> (opcional)</span>}
              </label>
              {isStored && !isReplacing ? (
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-emerald-600 dark:text-emerald-400">Guardado ✓</span>
                  <button
                    type="button"
                    onClick={() => setReplacing((r) => ({ ...r, [field.key]: true }))}
                    className="text-xs underline"
                  >
                    Reemplazar
                  </button>
                </div>
              ) : (
                <input
                  id={`secret-${field.key}`}
                  type="password"
                  autoComplete="off"
                  value={secrets[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => setSecrets((s) => ({ ...s, [field.key]: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
                />
              )}
              {field.hint && <p className="mt-1 text-[11px] text-muted-foreground">{field.hint}</p>}
            </div>
          );
        })}

        {provider.configFields.map((field) => (
          <div key={field.key}>
            <label htmlFor={`config-${field.key}`} className="text-xs font-medium">
              {field.label}
              {!field.required && <span className="text-muted-foreground"> (opcional)</span>}
            </label>
            <input
              id={`config-${field.key}`}
              list={field.options ? `options-${field.key}` : undefined}
              value={config[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            />
            {field.options && (
              <datalist id={`options-${field.key}`}>
                {field.options.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            )}
            {field.hint && <p className="mt-1 text-[11px] text-muted-foreground">{field.hint}</p>}
          </div>
        ))}

        {webhookUrl && <CopyableUrl label="Direccion para pegar en el proveedor" url={webhookUrl} />}
      </div>

      {provider.connection === "oauth_app" && (
        <ConnectWithProvider
          provider={provider}
          connected={connected}
          allSecretsSaved={fields.every((f) => stored.has(f.key))}
        />
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {/* Solo las redes que arman cuentas sociales (F74): Zernio y Postproxy. */}
      {connected && (provider.id === "zernio" || provider.id === "postproxy") && (
        <button
          type="button"
          onClick={syncAccounts}
          disabled={pending}
          className="mt-4 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          Sincronizar cuentas
        </button>
      )}

      {confirmingDisconnect ? (
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Desconectar {provider.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Se borran sus claves. {scheduledUses === null
              ? "Revisando si hay publicaciones programadas..."
              : scheduledUses === 0
                ? "No hay publicaciones programadas que dependan de esto."
                : `Hay ${scheduledUses} publicacion(es) programada(s) que dependen de esto y van a fallar.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirmDisconnect}
              disabled={pending}
              className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-60"
            >
              Si, desconectar
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(false)}
              className="h-9 rounded-lg border border-border px-3 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Probar y guardar
          </button>
          {connected && (
            <button
              type="button"
              onClick={askDisconnect}
              disabled={pending}
              className="h-9 rounded-lg border border-border px-3 text-sm"
            >
              Desconectar
            </button>
          )}
          <Link
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline"
          >
            De donde saco estos datos
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Zernio se guarda por su ruta de siempre, no por `saveIntegration`.
 *
 * `/api/v1/channels/test-key` valida la clave, registra el webhook,
 * sincroniza los canales y trae el historial de la bandeja en el mismo paso.
 */
async function saveZernio(secrets: Record<string, string>) {
  const apiKey = (secrets.api_key ?? "").trim();
  if (!apiKey) {
    return { ok: false as const, error: "Pega la API key de Zernio para volver a probarla" };
  }

  const res = await fetch("/api/v1/channels/test-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.error) {
    return { ok: false as const, error: data.error || `No se pudo conectar (${res.status})` };
  }
  return { ok: true as const, warnings: (data.warnings ?? []) as string[] };
}

function CopyableUrl({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{url}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs"
        >
          <Copy className="h-3 w-3" aria-hidden />
          {copied ? "Copiada" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

/**
 * El paso de autorizar, para las integraciones de OAuth.
 *
 * Son dos pasos y en este orden: primero se guardan Client ID y Secret (los
 * datos de la app del negocio), y recien despues se autoriza la cuenta. Sin
 * los secretos guardados el boton no sirve, asi que se muestra deshabilitado
 * con el motivo en vez de mandar a una pantalla de error del proveedor.
 *
 * Es un link y no un boton con fetch: el navegador tiene que NAVEGAR al
 * proveedor, y la cookie del `state` se pone en esa misma respuesta.
 *
 * El `redirect_to` vuelve siempre al LISTADO, no a este detalle: la lista
 * corta de `safeRedirect` (lib/oauth/state.ts) es del flujo de OAuth, que
 * este bloque no toca (G10).
 */
function ConnectWithProvider({
  provider,
  connected,
  allSecretsSaved,
}: {
  provider: ProviderDefinition;
  connected: boolean;
  allSecretsSaved: boolean;
}) {
  const href = `/api/oauth/${provider.id}/start?redirect_to=${encodeURIComponent("/dashboard/settings/integrations")}`;

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">
        {connected
          ? "La cuenta ya esta autorizada. Volver a autorizar sirve si cambiaron los permisos."
          : "Guarda los datos de la app y despues autoriza la cuenta."}
      </p>
      {allSecretsSaved ? (
        <a
          href={href}
          className="mt-2 inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          {connected ? `Volver a autorizar ${provider.label}` : `Autorizar ${provider.label}`}
        </a>
      ) : (
        <p className="mt-2 text-xs">
          Guarda primero el Client ID y el Secret para poder autorizar.
        </p>
      )}
    </div>
  );
}
