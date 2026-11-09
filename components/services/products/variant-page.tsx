// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Loader2, Pencil } from "lucide-react";
import { copyVariantSetup } from "@/lib/actions/services";
import { serviceMode, type ServiceMode } from "@/lib/services/settings";
import { MODE_LABELS } from "@/lib/services/screens/service-settings-form";
import { VARIANT_TAB_LABELS, variantRowView, type VariantTabKey } from "@/lib/services/screens/product-cards";
import type { ServiceProduct, ServiceVariant } from "@/lib/services/screens/load-products";
import { ActionError } from "@/components/contacts/ui";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { Historial } from "@/components/historial/historial";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { VariantDialog, type VariantFormValues } from "@/components/catalog/variant-dialog";
import { VariantPriceTab } from "@/components/catalog/variant-price-tab";
import { formFrom } from "@/components/catalog/product-detail";
import { asCatalogVariant } from "./service-product-page";
import { ServiceSettingsPanel, type NamedOption } from "./service-settings-panel";
import { JourneyEditor, type JourneyRefs } from "./journey-editor";
import { VariantPortalPanel } from "./variant-portal-panel";
import type { PathWorkflow } from "@/lib/services/screens/workflow-chips";
import { cn } from "@/lib/utils";

export interface CopySource {
  id: string;
  label: string;
}

/**
 * Ajustes › Productos › producto › variante (F114, nivel 3): migas, nombre, precio, modo y portal; «Copiar de otra
 * variante» y «Renombrar»; las pestañas Camino del cliente · Servicio · Portal · Precio y cobro, cada una con su
 * permiso. La pestaña vive en la URL (`?tab=`) y se cambia sin pedirle la página al servidor.
 */
export function VariantPage({
  product,
  variant,
  tabs,
  initialTab,
  members,
  refs,
  copySources,
  userNames,
  timeZone,
  can,
  workflows,
}: {
  product: ServiceProduct;
  variant: ServiceVariant;
  tabs: VariantTabKey[];
  initialTab: VariantTabKey;
  members: NamedOption[];
  refs: JourneyRefs;
  copySources: CopySource[];
  userNames: Record<string, string>;
  timeZone: string;
  can: { sections: boolean; rules: boolean; flows: boolean };
  workflows: PathWorkflow[];
}) {
  const [tab, setTab] = useState<VariantTabKey>(initialTab);
  const [renaming, setRenaming] = useState<VariantFormValues | null>(null);
  const [copying, setCopying] = useState(false);
  const row = variantRowView(product.id, variant);
  const mode: ServiceMode = serviceMode(variant.serviceSettings);

  function go(next: VariantTabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  const siblings = product.variants.filter((v) => v.id !== variant.id && !v.archived).map((v) => ({ id: v.id, name: v.name, mode: serviceMode(v.serviceSettings) }));
  const productHref = `/dashboard/settings/productos/${product.id}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        tabs={<SettingsTabs />}
        title={variant.name}
        tooltip="La configuración de esta variante: su camino, qué pasa al cobrarse, su portal y su precio."
        backHref={
          <Link href={productHref} aria-label={`Volver a ${product.name}`} className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-8">
          <nav aria-label="Migas" className="text-sm text-muted-foreground">
            <Link href="/dashboard/settings/productos" className="hover:text-foreground">
              Productos
            </Link>{" "}
            ›{" "}
            <Link href={productHref} className="hover:text-foreground">
              {product.name}
            </Link>
          </nav>
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-lg font-semibold">{variant.name}</h1>
            <span className="text-sm text-foreground">{row.priceLabel}</span>
            {tabs.length > 1 && (
              <>
                <span className="text-sm text-muted-foreground">{MODE_LABELS[mode]}</span>
                <span className="text-sm text-muted-foreground">Portal: {row.portalLabel}</span>
              </>
            )}
            <div className="ml-auto flex gap-2">
              {tabs.length > 1 && (
                <button type="button" onClick={() => setCopying(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Copiar de otra variante
                </button>
              )}
              <button type="button" onClick={() => setRenaming(formFrom(asCatalogVariant(variant), product.type))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Renombrar
              </button>
            </div>
          </header>

          <div role="tablist" aria-label="Configuración de la variante" className="flex gap-1 overflow-x-auto border-b border-border">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => go(t)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm",
                  tab === t ? "border-primary-edge font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {VARIANT_TAB_LABELS[t]}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === "camino" &&
              (mode === "create" ? (
                <JourneyEditor variantId={variant.id} template={variant.journeyTemplate} rev={variant.journeyTemplateRev} refs={refs} members={members} workflows={workflows} canEditFlows={can.flows} />
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  {mode === "extend" ? "Usa el camino del servicio que extiende." : "Esta variante no crea servicio. Elegí «Crea un servicio» en la pestaña Servicio para armarle un camino."}
                </p>
              ))}
            {tab === "servicio" && (
              <ServiceSettingsPanel variantId={variant.id} productId={product.id} settings={variant.serviceSettings} rev={variant.serviceSettingsRev} members={members} siblings={siblings} />
            )}
            {tab === "portal" && (
              <VariantPortalPanel
                variantId={variant.id}
                productId={product.id}
                productName={product.name}
                settings={variant.portalSettings}
                rev={variant.portalSettingsRev}
                programSettings={product.portalSettings}
                programRev={product.portalSettingsRev}
                canSections={can.sections}
                canRules={can.rules}
              />
            )}
            {tab === "precio" && (
              <div className="space-y-6">
                <VariantPriceTab variantId={variant.id} price={variant.rawPrice} userNames={userNames} timeZone={timeZone} />
                <section aria-label="Historial de la variante" className="rounded-xl border border-border p-4">
                  <h3 className="mb-3 text-sm font-semibold">Historial</h3>
                  <Historial entityType="product_variant" entityId={variant.id} names={{ users: userNames }} timeZone={timeZone} />
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
      {renaming && <VariantDialog productId={product.id} productType={product.type} initial={renaming} onClose={() => setRenaming(null)} />}
      {copying && <CopyDialog toVariantId={variant.id} sources={copySources} onClose={() => setCopying(false)} />}
    </div>
  );
}

function CopyDialog({ toVariantId, sources, onClose }: { toVariantId: string; sources: CopySource[]; onClose: () => void }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [parts, setParts] = useState<Array<"journey" | "service" | "portal">>(["journey", "service", "portal"]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (p: "journey" | "service" | "portal", on: boolean) => setParts((xs) => (on ? [...xs, p] : xs.filter((x) => x !== p)));

  function submit() {
    setError(null);
    start(async () => {
      const res = await copyVariantSetup(from, toVariantId, parts);
      if (!res.ok) return setError(res.error.message);
      if (res.data.status !== "ok") return setError("No se pudo copiar: revisá la variante de origen.");
      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      title="Copiar de otra variante"
      label="Copiar de otra variante"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button type="button" disabled={pending || !from || parts.length === 0} onClick={submit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Copiar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <DialogField label="De qué variante" hint="Lo que se copie reemplaza lo de esta variante. Si es de otro producto, los pasos que apuntan a cosas de ese producto quedan marcados «(Requiere atención)».">
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={fieldInput}>
            <option value="">Elegí…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </DialogField>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Qué copiar</legend>
          {(
            [
              ["journey", "El camino del cliente"],
              ["service", "Qué pasa al cobrarse"],
              ["portal", "El portal"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={parts.includes(k)} onChange={(e) => toggle(k, e.target.checked)} />
              {l}
            </label>
          ))}
        </fieldset>
        {error && <ActionError message={error} />}
      </div>
    </ContentDialog>
  );
}
