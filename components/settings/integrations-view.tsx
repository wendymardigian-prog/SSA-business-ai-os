"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Plug,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  PROVIDERS,
  providersByType,
  validateApiKey,
  validateConfig,
  type ProviderDefinition,
} from "@/lib/integrations/providers";
import {
  saveIntegration,
  disconnectIntegration,
} from "@/lib/actions/integrations";

export interface IntegrationState {
  providerId: string;
  isActive: boolean;
  connectedAt: string | null;
  lastError: string | null;
  config: Record<string, string>;
  /** Hay una key guardada en Vault. El valor nunca llega al cliente. */
  hasSecret: boolean;
}

interface ChannelSummary {
  id: string;
  platform: string;
  label: string;
  isActive: boolean;
  connectionStatus: string;
}

const OTHER = "__otro__";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Cartelito de estado arriba a la derecha de cada card. */
function StatusBadge({ state }: { state: IntegrationState }) {
  if (state.lastError) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
        <TriangleAlert className="h-3 w-3" />
        Error
      </span>
    );
  }
  if (state.isActive) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
        <Check className="h-3 w-3" />
        Conectado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      No conectado
    </span>
  );
}

function IntegrationCard({
  provider,
  state,
  onChanged,
}: {
  provider: ProviderDefinition;
  state: IntegrationState;
  onChanged: (next: IntegrationState) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of provider.configFields) {
      initial[field.key] = state.config[field.key] ?? field.defaultValue ?? "";
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  function setField(key: string, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSaved(false);
  }

  async function handleSave() {
    if (saving) return;
    setError(null);
    setSaved(false);

    // Validacion en cliente para dar feedback inmediato. El servidor la vuelve
    // a correr igual: esta se puede saltear, la del servidor no.
    if (apiKey.trim() || !state.hasSecret) {
      const keyCheck = validateApiKey(provider.id, apiKey);
      if (!keyCheck.ok) {
        setError(keyCheck.error);
        return;
      }
    }
    const configCheck = validateConfig(provider.id, config);
    if (!configCheck.ok) {
      setError(configCheck.error);
      return;
    }

    setSaving(true);
    const result = await saveIntegration(provider.id, apiKey, config);
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setApiKey("");
    setShowKey(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    onChanged({
      ...state,
      isActive: true,
      hasSecret: true,
      lastError: null,
      connectedAt: state.connectedAt ?? new Date().toISOString(),
      config,
    });
  }

  async function handleDisconnect() {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    setError(null);

    const result = await disconnectIntegration(provider.id);
    setDisconnecting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setApiKey("");
    onChanged({ ...state, isActive: false, hasSecret: false, connectedAt: null, lastError: null });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{provider.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{provider.description}</p>
        </div>
        <StatusBadge state={state} />
      </div>

      {state.isActive && state.connectedAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          Conectado desde el {formatDate(state.connectedAt)}.
        </p>
      )}

      {state.lastError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.lastError}
        </p>
      )}

      {/* API key */}
      <div className="mt-4">
        <label
          htmlFor={`key-${provider.id}`}
          className="text-xs font-medium text-muted-foreground"
        >
          API key
        </label>
        {state.hasSecret && !apiKey && (
          <p className="mt-1 font-mono text-sm text-muted-foreground">••••••••••••••••</p>
        )}
        <div className="relative mt-1.5">
          <input
            id={`key-${provider.id}`}
            type={showKey ? "text" : "password"}
            value={apiKey}
            autoComplete="off"
            onChange={(e) => {
              setApiKey(e.target.value);
              setError(null);
              setSaved(false);
            }}
            placeholder={
              state.hasSecret
                ? "Pega una key nueva para reemplazar la actual"
                : `Pega tu API key de ${provider.label}`
            }
            className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 font-mono text-sm placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            aria-label={showKey ? "Ocultar la key" : "Mostrar la key"}
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Se guarda encriptada y no se vuelve a mostrar.{" "}
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80"
          >
            De donde la saco
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      {/* Campos de config (remitente, modelo) */}
      {provider.configFields.map((field) => {
        const value = config[field.key] ?? "";
        const usesSelect = Boolean(field.options?.length);
        const isCustom = usesSelect && value !== "" && !field.options?.includes(value);

        return (
          <div key={field.key} className="mt-4">
            <label
              htmlFor={`${provider.id}-${field.key}`}
              className="text-xs font-medium text-muted-foreground"
            >
              {field.label}
              {!field.required && " (opcional)"}
            </label>

            {usesSelect ? (
              <>
                <select
                  id={`${provider.id}-${field.key}`}
                  value={isCustom ? OTHER : value}
                  onChange={(e) =>
                    setField(field.key, e.target.value === OTHER ? "" : e.target.value)
                  }
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={OTHER}>Otro (escribirlo a mano)</option>
                </select>
                {isCustom && (
                  <input
                    type="text"
                    value={value}
                    aria-label={`${field.label} personalizado`}
                    onChange={(e) => setField(field.key, e.target.value)}
                    placeholder="Identificador del modelo"
                    className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </>
            ) : (
              <input
                id={`${provider.id}-${field.key}`}
                type="text"
                value={value}
                onChange={(e) => setField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}

            {field.hint && (
              <p className="mt-1.5 text-xs text-muted-foreground">{field.hint}</p>
            )}
          </div>
        );
      })}

      {error && (
        <p role="alert" className="mt-4 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || disconnecting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          {saving ? "Guardando..." : state.hasSecret ? "Guardar cambios" : "Conectar"}
        </button>

        {state.isActive && (
          <button
            onClick={() => setConfirmDisconnect(true)}
            disabled={saving || disconnecting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {disconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Desconectar
          </button>
        )}

        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3.5 w-3.5" />
            Guardado
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        title={`Desconectar ${provider.label}`}
        message={`Se borra la API key guardada. Lo que dependa de ${provider.label} deja de funcionar hasta que la vuelvas a pegar.`}
        confirmLabel="Desconectar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={handleDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}


/**
 * Card de Instagram (Zernio). No usa el catalogo generico porque su conexion
 * no es solo guardar una key: el servidor valida contra la API de Zernio,
 * registra el webhook y sincroniza los canales en la misma llamada.
 */
function ZernioCard({
  hasKey,
  keyInVault,
}: {
  hasKey: boolean;
  keyInVault: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [connected, setConnected] = useState(hasKey);

  async function handleConnect() {
    const key = apiKey.trim();
    if (!key || connecting) return;

    setConnecting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/v1/channels/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || `No se pudo conectar (${res.status})`);
        return;
      }

      const count = (data.accounts ?? []).length;
      setApiKey("");
      setShowKey(false);
      setConnected(true);
      setResult(
        count === 1 ? "1 cuenta encontrada y sincronizada" : `${count} cuentas encontradas y sincronizadas`,
      );
    } catch {
      setError("No pude contactar al servidor");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Instagram (Zernio)</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            DMs, comentarios y respuestas a stories de Instagram.
          </p>
        </div>
        {connected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
            <Check className="h-3 w-3" />
            Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            No conectado
          </span>
        )}
      </div>

      {connected && !keyInVault && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          La key de Zernio esta guardada de antes, sin encriptar. Volve a pegarla aca
          para que quede guardada de forma segura.
        </p>
      )}

      <div className="mt-4">
        <label htmlFor="zernio-key" className="text-xs font-medium text-muted-foreground">
          API key de Zernio
        </label>
        {connected && !apiKey && (
          <p className="mt-1 font-mono text-sm text-muted-foreground">••••••••••••••••</p>
        )}
        <div className="relative mt-1.5">
          <input
            id="zernio-key"
            type={showKey ? "text" : "password"}
            value={apiKey}
            autoComplete="off"
            onChange={(e) => {
              setApiKey(e.target.value);
              setError(null);
              setResult(null);
            }}
            placeholder={
              connected ? "Pega una key nueva para reemplazar la actual" : "Pega tu API key de Zernio"
            }
            className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 font-mono text-sm placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            aria-label={showKey ? "Ocultar la key" : "Mostrar la key"}
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Al conectar se validan tus cuentas, se registra el webhook y se sincronizan los
          canales.{" "}
          <a
            href="https://zernio.com/dashboard/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80"
          >
            De donde la saco
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleConnect}
          disabled={!apiKey.trim() || connecting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          {connecting ? "Conectando..." : connected ? "Reemplazar key" : "Conectar"}
        </button>

        {result && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3.5 w-3.5" />
            {result}
          </span>
        )}
      </div>
    </div>
  );
}

export function IntegrationsView({
  integrations: initial,
  zernio,
  channels,
}: {
  integrations: IntegrationState[];
  zernio: { hasKey: boolean; keyInVault: boolean };
  channels: ChannelSummary[];
}) {
  const [integrations, setIntegrations] = useState(initial);

  function updateOne(next: IntegrationState) {
    setIntegrations((prev) =>
      prev.map((i) => (i.providerId === next.providerId ? next : i)),
    );
  }

  const stateOf = (providerId: string) =>
    integrations.find((i) => i.providerId === providerId) ?? {
      providerId,
      isActive: false,
      connectedAt: null,
      lastError: null,
      config: {},
      hasSecret: false,
    };

  const connectedChannels = channels.filter((c) => c.isActive);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Integraciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecta el email saliente y tus proveedores de IA. Las API keys se guardan
          encriptadas y no se vuelven a mostrar.
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-10 px-8 py-8">
          {/* Canales — viven en su propia pantalla, aca solo el resumen */}
          <section>
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Canales de mensajeria</h2>
            </div>
            <div className="mt-4">
              <ZernioCard hasKey={zernio.hasKey} keyInVault={zernio.keyInVault} />
            </div>

            <Link
              href="/dashboard/channels"
              className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card p-5 hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">
                  {connectedChannels.length === 0
                    ? "Todavia no hay canales conectados"
                    : `${connectedChannels.length} ${connectedChannels.length === 1 ? "canal conectado" : "canales conectados"}`}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {connectedChannels.length === 0
                    ? "WhatsApp se vincula con QR desde la pantalla de canales."
                    : connectedChannels.map((c) => c.label).join(", ")}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </section>

          {/* Email */}
          <section>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Email saliente</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Sin esto, las invitaciones al equipo y los avisos del sistema no salen por
              email: el sistema te muestra el link para pasarlo a mano.
            </p>
            <div className="mt-4 space-y-4">
              {providersByType("email_provider").map((provider) => (
                <IntegrationCard
                  key={provider.id}
                  provider={provider}
                  state={stateOf(provider.id)}
                  onChanged={updateOne}
                />
              ))}
            </div>
          </section>

          {/* IA */}
          <section>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Proveedores de IA (BYOK)</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Traes tu propia cuenta: el consumo se factura directo a tu cuenta del
              proveedor. Podes conectar uno, varios o ninguno.
            </p>
            <div className="mt-4 space-y-4">
              {providersByType("ai_provider").map((provider) => (
                <IntegrationCard
                  key={provider.id}
                  provider={provider}
                  state={stateOf(provider.id)}
                  onChanged={updateOne}
                />
              ))}
            </div>
          </section>

          <p className={cn("text-xs text-muted-foreground")}>
            {PROVIDERS.length} integraciones disponibles. En Etapa 2 se suman YouTube,
            LinkedIn y TikTok para publicacion de contenido.
          </p>
        </div>
      </div>
    </div>
  );
}
