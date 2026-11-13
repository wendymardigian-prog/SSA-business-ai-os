// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { isModuleEnabled } from "@/lib/services/module";
import { loadServiceProduct, loadServiceProducts } from "@/lib/services/screens/load-products";
import { parseVariantTab, variantTabs } from "@/lib/services/screens/product-cards";
import { VariantPage } from "@/components/services/products/variant-page";
import { loadPathWorkflows } from "@/lib/services/screens/load-workflows";

/**
 * Ajustes › Productos › producto › variante (F114, nivel 3). Entrar pide `products.manage`; cada pestaña, la suya.
 * Con el modulo apagado se ve solo «Precio y cobro».
 */
export default async function VariantSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; variantId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id, variantId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePermission("products.manage");
  const { workspace, supabase } = ctx;
  const moduleOn = isModuleEnabled(workspace as { services_enabled?: boolean | null });

  const product = await loadServiceProduct(supabase, workspace.id, id);
  const variant = product?.variants.find((v) => v.id === variantId);
  if (!product || !variant) notFound();

  const tabs = variantTabs({ moduleOn, can: ctx.can });
  const [team, forms, events, all, timeZone, certificates] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    supabase.from("forms").select("id, name, type").eq("workspace_id", workspace.id).is("archived_at", null).order("name"),
    supabase.from("event_types").select("id, title").eq("workspace_id", workspace.id).order("title"),
    moduleOn ? loadServiceProducts(supabase, workspace.id) : Promise.resolve([]),
    resolveViewerTimezone((workspace as { timezone?: string }).timezone),
    // F66: las plantillas de certificado del Diseñador IA (las que esta persona ve).
    moduleOn ? supabase.from("design_templates").select("id, name").eq("workspace_id", workspace.id).eq("doc_type", "certificado").is("archived_at", null).order("name") : Promise.resolve({ data: [] }),
  ]);
  // F117: los workflows del camino se ven con services.configure y el permiso de ver Automatizaciones.
  const workflows = moduleOn && ctx.can("services.configure") && ctx.can("flows.view") ? await loadPathWorkflows(supabase, workspace.id, variant.id, new Set((variant.journeyTemplate?.phases ?? []).flatMap((ph) => ph.items.map((i) => i.key)))) : [];
  const members = team.map((m) => ({ id: m.userId, name: m.name }));
  const copySources = all.flatMap((p) => p.variants.filter((v) => v.id !== variant.id && !v.archived).map((v) => ({ id: v.id, label: `${p.name} › ${v.name}` })));

  return (
    <VariantPage
      product={product}
      variant={variant}
      tabs={tabs}
      initialTab={parseVariantTab(sp.tab, tabs)}
      members={members}
      refs={{
        forms: ((forms.data ?? []) as Array<{ id: string; name: string; type: string }>).map((f) => ({ id: f.id, name: f.name, type: f.type })),
        eventTypes: ((events.data ?? []) as Array<{ id: string; title: string }>).map((e) => ({ id: e.id, name: e.title })),
        certificates: ((certificates.data ?? []) as Array<{ id: string; name: string }>).map((c) => ({ id: c.id, name: c.name })),
      }}
      copySources={copySources}
      userNames={Object.fromEntries(memberLabels(team))}
      timeZone={timeZone}
      can={{ sections: ctx.can("portal.sections"), rules: ctx.can("portal.access_rules"), flows: ctx.can("flows.edit") }}
      workflows={workflows}
    />
  );
}
