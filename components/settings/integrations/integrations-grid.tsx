"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { providersBySection, getProvider } from "@/lib/integrations/providers";
import { needsAttention } from "@/lib/integrations/status";
import { IntegrationCard } from "./integration-card";
import { IntegrationModal } from "./integration-modal";
import type { IntegrationCardData } from "./types";

/**
 * La pantalla de integraciones (F2).
 *
 * Secciones con grilla (1 columna en el celular, 2 desde 768 px, 3 desde
 * 1280), cards compactas y toda la configuracion en un modal. El filtro
 * "Requiere atencion" vive en la barra superior, no adentro del contenido
 * (F7): esta pantalla es la primera que sigue esa convencion.
 */
export function IntegrationsGrid({
  integrations,
  webhookUrls,
  channelsSummary,
}: {
  integrations: Record<string, IntegrationCardData>;
  /** Direcciones que hay que pegar en cada proveedor, por id. */
  webhookUrls: Record<string, string>;
  /** Cuentas conectadas por Zernio, para mostrarlas en su modal. */
  channelsSummary: Array<{ id: string; label: string; platform: string }>;
}) {
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const sections = useMemo(() => {
    return providersBySection()
      .map((section) => ({
        ...section,
        providers: section.providers.filter((provider) => {
          if (!onlyAttention) return true;
          const data = integrations[provider.id];
          return data ? needsAttention(data.status) : false;
        }),
      }))
      .filter((section) => section.providers.length > 0);
  }, [integrations, onlyAttention]);

  const openProvider = openId ? getProvider(openId) : undefined;
  const openData = openId ? integrations[openId] : undefined;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Integraciones"
        tooltip="Todo lo que este sistema conecta con afuera: canales, redes, email e IA. Las claves se guardan encriptadas y nunca se muestran."
        right={
          <button
            type="button"
            onClick={() => setOnlyAttention((v) => !v)}
            aria-pressed={onlyAttention}
            className={`h-8 rounded-lg border px-3 text-sm ${
              onlyAttention
                ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-border hover:bg-accent"
            }`}
          >
            Requiere atencion
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {sections.length === 0 ? (
          <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
            {onlyAttention
              ? "Todo en orden: ninguna integracion necesita que hagas nada."
              : "Todavia no hay integraciones para mostrar."}
          </p>
        ) : (
          <div className="mx-auto max-w-6xl space-y-8">
            {sections.map((section) => (
              <section key={section.section}>
                <h2 className="text-sm font-semibold text-muted-foreground">{section.label}</h2>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {section.providers.map((provider) => (
                    <IntegrationCard
                      key={provider.id}
                      provider={provider}
                      data={integrations[provider.id]}
                      onOpen={() => setOpenId(provider.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {openProvider && openData && (
        <IntegrationModal
          provider={openProvider}
          data={openData}
          webhookUrl={webhookUrls[openProvider.id] ?? null}
          onClose={() => setOpenId(null)}
          onSave={openProvider.id === "zernio" ? saveZernio : undefined}
          extraFooter={
            openProvider.id === "zernio" ? (
              <ZernioFooter channels={channelsSummary} />
            ) : openProvider.connection === "qr" ? (
              <Link href="/dashboard/channels" className="text-sm underline">
                Abrir WhatsApp (QR)
              </Link>
            ) : null
          }
        />
      )}
    </div>
  );
}

/**
 * Zernio se guarda por su ruta de siempre.
 *
 * `/api/v1/channels/test-key` no solo valida la clave: registra el webhook,
 * sincroniza los canales y trae el historial de la bandeja. Guardarla con la
 * accion generica dejaria la clave en Vault y la bandeja sin canales, que es
 * peor que no guardarla.
 */
async function saveZernio(values: { secrets: Record<string, string> }) {
  const apiKey = (values.secrets.api_key ?? "").trim();
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
  return { ok: true as const };
}

function ZernioFooter({ channels }: { channels: Array<{ id: string; label: string; platform: string }> }) {
  if (channels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Todavia no hay cuentas conectadas. Al guardar la clave se sincronizan solas.
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs font-medium">Cuentas conectadas</p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {channels.map((channel) => (
          <li key={channel.id}>
            {channel.label} <span className="opacity-70">({channel.platform})</span>
          </li>
        ))}
      </ul>
      <Link href="/dashboard/channels" className="mt-2 inline-block text-xs underline">
        Administrar canales
      </Link>
    </div>
  );
}
