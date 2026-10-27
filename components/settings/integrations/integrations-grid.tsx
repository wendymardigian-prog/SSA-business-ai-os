"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import {
  providersBySection,
  CHIP_ORDER,
  CHIP_LABELS,
  type IntegrationChip,
} from "@/lib/integrations/providers";
import { filterSections, countByChip } from "@/lib/integrations/grid-filter";
import { IntegrationCard } from "./integration-card";
import { CHANNEL_PROVIDER_IDS, type IntegrationSections } from "@/lib/integrations/sections";
import type { IntegrationCardData } from "./types";

/**
 * La pantalla de integraciones (F2, Bloque G).
 *
 * Dos secciones con chips de tipo (G1), cards que navegan al detalle en vez
 * de abrir un modal (G2, G5), y la franja de primera conexion (G8). El chip y
 * "Requiere atencion" viven en la URL (`?tipo=`, `?atencion=1`): sobreviven
 * la ida y vuelta al detalle de una integracion.
 */
const ALL_SECTIONS = providersBySection();
const CHIP_COUNTS = countByChip(ALL_SECTIONS);

export function IntegrationsGrid({
  integrations,
  fathom,
  fathomNeedsAttention = false,
  extra,
  mine,
  access,
}: {
  integrations: Record<string, IntegrationCardData>;
  /**  @plantilla-quitar(llamadas)
   * La card de Fathom (la app OAuth del negocio): no esta en el catalogo, pero se muestra en "Conexiones" junto a las  @plantilla-quitar(llamadas)
   * demas, con el mismo diseno. Respeta los chips (sin chip) y "Requiere atencion" (solo si necesita atencion).  @plantilla-quitar(llamadas)
   * @plantilla-quitar(llamadas) */
  fathom?: React.ReactNode;
  fathomNeedsAttention?: boolean;
  /** Cards propias que no pasan por el catalogo (Webhooks): se muestran sin filtros activos. */
  extra?: React.ReactNode;
  /** «Mis conexiones»: las conexiones personales (Google Calendar y otras) de la propia persona. Lo ve todo el equipo. */
  mine?: React.ReactNode;
  /** Que puede hacer en Canales y en Integraciones del negocio (lib/integrations/sections.ts). */
  access: Pick<IntegrationSections, "channels" | "business">;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const chipParam = searchParams.get("tipo");
  const chip: IntegrationChip | null =
    chipParam && (CHIP_ORDER as readonly string[]).includes(chipParam) ? (chipParam as IntegrationChip) : null;
  const onlyAttention = searchParams.get("atencion") === "1";

  function updateParams(next: { tipo?: IntegrationChip | null; atencion?: boolean }) {
    const params = new URLSearchParams(searchParams.toString());
    if ("tipo" in next) {
      if (next.tipo) params.set("tipo", next.tipo);
      else params.delete("tipo");
    }
    if ("atencion" in next) {
      if (next.atencion) params.set("atencion", "1");
      else params.delete("atencion");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const sections = useMemo(
    () => filterSections(ALL_SECTIONS, (id) => integrations[id], { chip, onlyAttention }),
    [integrations, chip, onlyAttention],
  );

  // Canales por un lado; el resto (conexiones del negocio e IA) por el otro.
  const channelProviders = useMemo(
    () => sections.flatMap((section) => section.providers).filter((p) => CHANNEL_PROVIDER_IDS.includes(p.id)),
    [sections],
  );
  const businessSections = useMemo(
    () =>
      sections
        .map((section) => ({ ...section, providers: section.providers.filter((p) => !CHANNEL_PROVIDER_IDS.includes(p.id)) }))
        .filter((section) => section.providers.length > 0),
    [sections],
  );
  const hasShared = access.channels !== null || access.business !== null;

  // Fathom no tiene chip: aparece con "Todos" y, con "Requiere atencion", solo si la necesita.  @plantilla-quitar(llamadas)
  const showFathom = Boolean(fathom) && chip === null && (!onlyAttention || fathomNeedsAttention);
  const nothingConnectedYet = !Object.values(integrations).some((data) => data.status !== "not_connected");

  function detailHrefFor(providerId: string): string {
    const params = new URLSearchParams();
    if (chip) params.set("tipo", chip);
    if (onlyAttention) params.set("atencion", "1");
    const qs = params.toString();
    return `/dashboard/settings/integrations/${providerId}${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Integraciones"
        tooltip="Todo lo que este sistema conecta con afuera: canales, redes, email e IA. Las claves se guardan encriptadas y nunca se muestran."
        right={
          hasShared ? (
            <button
              type="button"
              onClick={() => updateParams({ atencion: !onlyAttention })}
              aria-pressed={onlyAttention}
              className={`h-8 rounded-lg border px-3 text-sm ${
                onlyAttention
                  ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border hover:bg-accent"
              }`}
            >
              Requiere atencion
            </button>
          ) : undefined
        }
      />
      <SettingsTabs />

      {hasShared && (
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 md:px-6">
          <ChipButton active={chip === null} label="Todos" onClick={() => updateParams({ tipo: null })} />
          {CHIP_ORDER.map((c) => {
            const count = CHIP_COUNTS[c] ?? 0;
            return (
              <ChipButton
                key={c}
                active={chip === c}
                disabled={count === 0}
                label={CHIP_LABELS[c]}
                onClick={() => updateParams({ tipo: chip === c ? null : c })}
              />
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-10">
          {/* Mis conexiones: de cada persona, no del negocio */}
          {mine && (
            <section aria-labelledby="mis-conexiones">
              <h2 id="mis-conexiones" className="text-sm font-semibold">Mis conexiones</h2>
              <p className="mt-1 text-xs text-muted-foreground">Tu propio Google Calendar y tu propio Fathom. Nadie más ve ni toca lo tuyo.</p>
              <div className="mt-3 space-y-4">{mine}</div>
            </section>
          )}

          {/* Canales */}
          {access.channels && channelProviders.length > 0 && (
            <section aria-labelledby="canales">
              <div className="flex items-center gap-2">
                <h2 id="canales" className="text-sm font-semibold">Canales</h2>
                {access.channels === "view" && <ReadOnlyBadge />}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {channelProviders.map((provider) => (
                  <IntegrationCard key={provider.id} provider={provider} data={integrations[provider.id]} detailHref={detailHrefFor(provider.id)} />
                ))}
              </div>
            </section>
          )}

          {/* Integraciones del negocio */}
          {access.business && (
            <section aria-labelledby="negocio">
              <div className="flex items-center gap-2">
                <h2 id="negocio" className="text-sm font-semibold">Integraciones del negocio</h2>
                {access.business === "view" && <ReadOnlyBadge />}
              </div>
              {businessSections.length === 0 && !showFathom ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {onlyAttention ? "Todo en orden: ninguna integración necesita que hagas nada." : "No hay integraciones de este tipo."}
                </p>
              ) : (
                <div className="mt-3 space-y-8">
                  {/* Sin nada conectado no se arma una tarjeta grande ni se recomienda nada: una linea y las tarjetas. */}
                  {nothingConnectedYet && !onlyAttention && chip === null && (
                    <p className="text-xs text-muted-foreground">Todavía no conectaste nada.</p>
                  )}
                  {businessSections.map((section, index) => (
                    <div key={section.section}>
                      <h3 className="text-xs font-semibold text-muted-foreground">{section.label}</h3>
                      <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {section.providers.map((provider) => (
                          <IntegrationCard key={provider.id} provider={provider} data={integrations[provider.id]} detailHref={detailHrefFor(provider.id)} />
                        ))}
                        {/* Fathom va con las demas conexiones, en la primera seccion (Conexiones).  @plantilla-quitar(llamadas) */}
                        {index === 0 && showFathom && fathom}
                      </div>
                    </div>
                  ))}
                  {businessSections.length === 0 && showFathom && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{fathom}</div>
                  )}
                  {extra && chip === null && !onlyAttention && <div aria-label="Otras conexiones">{extra}</div>}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyBadge() {
  return <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Solo lectura</span>;
}

function ChipButton({
  label,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`h-7 rounded-full border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
