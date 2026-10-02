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
import { missingEssentials } from "@/lib/integrations/onboarding";
import { IntegrationCard } from "./integration-card";
import { OnboardingBanner } from "./onboarding-banner";
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
}: {
  integrations: Record<string, IntegrationCardData>;
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

  const missing = useMemo(
    () => missingEssentials((id) => integrations[id]?.status),
    [integrations],
  );

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
        }
      />
      <SettingsTabs />

      <OnboardingBanner missing={missing} />

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
                      detailHref={detailHrefFor(provider.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
