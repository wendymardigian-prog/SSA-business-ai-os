"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { FilterMenu, MenuOption } from "@/components/ui/filter-menu";
import {
  providersBySection,
  CHIP_ORDER,
  CHIP_LABELS,
  type IntegrationChip,
} from "@/lib/integrations/providers";
import { filterSections, countByChip } from "@/lib/integrations/grid-filter";
import { IntegrationCard } from "./integration-card";
import { sectionOfProvider, type IntegrationSections } from "@/lib/integrations/sections";
import { BUSINESS_ORDER, orderCards } from "@/lib/integrations/card-order";
import { accountTabHref } from "@/lib/account/tabs";
import type { IntegrationCardData } from "./types";

/**
 * La pantalla de integraciones (F2, Bloque G).
 *
 * Dos secciones (12/11/2026): Integraciones del negocio (canales incluidos) e
 * Inteligencia artificial; las conectadas primero (lib/integrations/card-order.ts).
 * Las conexiones personales viven en Mi cuenta → Conexiones.
 *
 * Chips de tipo (G1), cards que navegan al detalle en vez
 * de abrir un modal (G2, G5), y la franja de primera conexion (G8). El chip y
 * "Requiere atencion" viven en la URL (`?tipo=`, `?atencion=1`): sobreviven
 * la ida y vuelta al detalle de una integracion.
 */
const ALL_SECTIONS = providersBySection();
const CHIP_COUNTS = countByChip(ALL_SECTIONS);

export function IntegrationsGrid({
  integrations,
  fathom, // @plantilla-quitar(llamadas)
  fathomNeedsAttention = false, // @plantilla-quitar(llamadas)
  fathomConnected = false, // @plantilla-quitar(llamadas)
  tail,
  access,
}: {
  integrations: Record<string, IntegrationCardData>;
  /**  @plantilla-quitar(llamadas)
   * La card de Fathom (la app OAuth del negocio): no esta en el catalogo, pero se muestra en "Conexiones" junto a las  @plantilla-quitar(llamadas)
   * demas, con el mismo diseno. Respeta los chips (sin chip) y "Requiere atencion" (solo si necesita atencion).  @plantilla-quitar(llamadas)
   * @plantilla-quitar(llamadas) */
  fathom?: React.ReactNode; // @plantilla-quitar(llamadas)
  fathomNeedsAttention?: boolean; // @plantilla-quitar(llamadas)
  fathomConnected?: boolean; // @plantilla-quitar(llamadas)
  /** Cards propias que no pasan por el catalogo (Sitio web, Webhooks): al final del negocio, sin filtros activos. */
  tail?: React.ReactNode;
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

  // Dos secciones (decision del 12/11/2026): Integraciones del negocio (canales incluidos) e Inteligencia artificial.
  // Cada card se muestra si la persona tiene acceso a SU parte (canales o negocio), con el mismo permiso de siempre.
  const visible = (providerId: string) => access[sectionOfProvider(providerId)] !== null;
  const connectedOf = (providerId: string) => (integrations[providerId]?.status ?? "not_connected") !== "not_connected";

  // Fathom no tiene chip: aparece con "Todos" y, con "Requiere atencion", solo si la necesita.  @plantilla-quitar(llamadas)
  const showFathom = Boolean(fathom) && chip === null && (!onlyAttention || fathomNeedsAttention); // @plantilla-quitar(llamadas)

  // Son pocas cards: se ordenan en cada pintada, sin memo.
  const cards: { id: string; connected: boolean; node: React.ReactNode }[] = sections
    .filter((section) => section.section !== "ai")
    .flatMap((section) => section.providers)
    .filter((provider) => visible(provider.id))
    .map((provider) => ({
      id: provider.id,
      connected: connectedOf(provider.id),
      node: <IntegrationCard key={provider.id} provider={provider} data={integrations[provider.id]} detailHref={detailHrefFor(provider.id)} />,
    }));
  if (showFathom) cards.push({ id: "fathom", connected: fathomConnected, node: <div key="fathom" className="contents">{fathom}</div> }); // @plantilla-quitar(llamadas)
  const businessCards = orderCards(cards, BUSINESS_ORDER);

  const aiProviders = orderCards(
    sections
      .filter((section) => section.section === "ai")
      .flatMap((section) => section.providers)
      .filter((provider) => visible(provider.id))
      .map((provider) => ({ id: provider.id, connected: connectedOf(provider.id), provider })),
  );

  const hasShared = access.channels !== null || access.business !== null;
  // Sitio web y Webhooks: siempre al final, sin filtros activos.
  const showTail = Boolean(tail) && access.business !== null && chip === null && !onlyAttention;
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
        tabs={<SettingsTabs />}
        title="Integraciones"
        tooltip="Todo lo que este sistema conecta con afuera: canales, redes, email e IA. Las claves se guardan encriptadas y nunca se muestran."
        filters={
          hasShared ? (
            // El tipo (antes una fila de chips debajo de la barra): un tipo sin integraciones se ve apagado.
            <FilterMenu label="Tipo" value={chip ? CHIP_LABELS[chip] : "Todos"} active={chip !== null} align="right" menuClassName="topbar:w-[220px]">
              <MenuOption checked={chip === null} onSelect={() => updateParams({ tipo: null })} title="Todos" />
              {CHIP_ORDER.map((c) => (
                <MenuOption
                  key={c}
                  checked={chip === c}
                  disabled={(CHIP_COUNTS[c] ?? 0) === 0}
                  onSelect={() => updateParams({ tipo: c })}
                  title={CHIP_LABELS[c]}
                  trailing={CHIP_COUNTS[c] ?? 0}
                />
              ))}
            </FilterMenu>
          ) : undefined
        }
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

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-10">
          {!hasShared && (
            <p className="text-sm text-muted-foreground">
              Las integraciones del negocio las maneja un admin. Tu propio Google Calendar y tu Fathom se conectan en{" "}
              <Link href={accountTabHref("conexiones")} className="text-primary-ink underline-offset-2 hover:underline">
                Mi cuenta → Conexiones
              </Link>
              .
            </p>
          )}

          {/* Integraciones del negocio: canales, email, redes, Fathom, y al final Sitio web y Webhooks */}
          {hasShared && (
            <section aria-labelledby="negocio">
              <div className="flex items-center gap-2">
                <h2 id="negocio" className="text-sm font-semibold">Integraciones del negocio</h2>
                {access.business !== "edit" && access.channels !== "edit" && <ReadOnlyBadge />}
              </div>
              {businessCards.length === 0 && !showTail ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {onlyAttention ? "Todo en orden: ninguna integración necesita que hagas nada." : "No hay integraciones de este tipo."}
                </p>
              ) : (
                <>
                  {/* Sin nada conectado no se arma una tarjeta grande ni se recomienda nada: una linea y las tarjetas. */}
                  {nothingConnectedYet && !onlyAttention && chip === null && (
                    <p className="mt-1 text-xs text-muted-foreground">Todavía no conectaste nada.</p>
                  )}
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {businessCards.map((card) => card.node)}
                    {showTail && tail}
                  </div>
                </>
              )}
            </section>
          )}

          {/* Inteligencia artificial */}
          {access.business && aiProviders.length > 0 && (
            <section aria-labelledby="ia">
              <div className="flex items-center gap-2">
                <h2 id="ia" className="text-sm font-semibold">Inteligencia artificial</h2>
                {access.business === "view" && <ReadOnlyBadge />}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {aiProviders.map(({ provider }) => (
                  <IntegrationCard key={provider.id} provider={provider} data={integrations[provider.id]} detailHref={detailHrefFor(provider.id)} />
                ))}
              </div>
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
