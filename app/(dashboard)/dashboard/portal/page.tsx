// @plantilla-quitar(servicios)
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { addableProducts, programCards, type ProgramProductRow, type ProgramVariantRow } from "@/lib/portal-admin/programs";
import { PageHeader } from "@/components/page-header";
import { EmptyHint } from "@/components/contacts/ui";
import { AddProgramDialog } from "@/components/services/portal/add-program-dialog";
import { PortalSettingsForm } from "@/components/services/portal/portal-settings-form";
import { ReviewList } from "@/components/services/portal/review-list";
import { loadReviewItems } from "@/lib/program/load-review";
import { svcRpc } from "@/lib/services/db";
import { cardMetricViews, parseMetricDays, type CardMetrics } from "@/lib/portal-admin/card-metrics";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Portal (F35, F43): Programas (los productos con portal y «+ Agregar programa») y Ajustes del portal. Pide alguna
 * clave del portal; cada pestaña la suya. Con el módulo apagado, 404. Se lee con la sesión de quien mira.
 */
export default async function PortalPage({ searchParams }: { searchParams: Promise<{ tab?: string; estudiante?: string; dias?: string; programa?: string }> }) {
  const ctx = await requireAnyPermission(["portal.view", "portal.sections", "portal.access_rules", "portal.settings", "submissions.review", "community.view"]);
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.portal", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const tabs = [
    { key: "programas", label: "Programas", show: ctx.can("portal.view") || ctx.can("portal.sections") || ctx.can("portal.access_rules") },
    { key: "revisar", label: "Por revisar", show: ctx.can("portal.view") || ctx.can("submissions.review") || ctx.can("community.view") },
    { key: "ajustes", label: "Ajustes del portal", show: ctx.can("portal.settings") || ctx.can("portal.view") },
  ].filter((t) => t.show);
  const sp = await searchParams;
  const asked = sp.tab;
  const tab = tabs.find((t) => t.key === asked) ?? tabs[0];

  let body: React.ReactNode;
  let right: React.ReactNode = null;
  if (tab.key === "revisar") {
    // Por revisar (F57): las entregas de todos los programas, leídas con el cliente de servicio después del permiso.
    const items = await loadReviewItems(await createServiceClient(), workspace.id, { contactId: sp.estudiante && /^[0-9a-f-]{36}$/i.test(sp.estudiante) ? sp.estudiante : null, productId: sp.programa && /^[0-9a-f-]{36}$/i.test(sp.programa) ? sp.programa : null });
    // Comentarios (F111): lo sin contestar de la comunidad y de las clases, por programa (con community.view).
    let comments: Array<{ id: string; name: string; unanswered: number }> = [];
    if (ctx.can("community.view")) {
      const { data: programs } = await supabase.from("products").select("id, name").eq("workspace_id", workspace.id).eq("portal_enabled" as never, true as never).is("archived_at", null);
      const counted = await Promise.all(
        ((programs ?? []) as Array<{ id: string; name: string }>).map(async (pr) => {
          const c = await svcRpc<{ unanswered?: number }>(supabase, "community_item_counts", { p_product_id: pr.id });
          return { id: pr.id, name: pr.name, unanswered: c.ok ? c.data?.unanswered ?? 0 : 0 };
        }),
      );
      comments = counted.filter((c) => c.unanswered > 0);
    }
    body = (
      <div className="space-y-6">
        <ReviewList items={items} canReview={ctx.can("submissions.review")} timeZone={await resolveViewerTimezone((workspace as { timezone?: string }).timezone)} />
        {ctx.can("community.view") && (
          <section aria-labelledby="comentarios" className="space-y-2">
            <h2 id="comentarios" className="text-sm font-semibold">Comentarios</h2>
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay comentarios sin contestar en los últimos 30 días.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {comments.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{c.name}</span>
                    <Link href={`/dashboard/portal/${c.id}?tab=comunidad&filtro=sin-contestar`} className="text-xs text-primary-ink hover:underline">
                      {c.unanswered === 1 ? "1 sin contestar" : `${c.unanswered} sin contestar`}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    );
  } else if (tab.key === "ajustes") {
    const { data } = await supabase.from("workspaces").select("portal_settings, portal_settings_rev").eq("id", workspace.id).maybeSingle();
    const row = data as { portal_settings?: Record<string, unknown> | null; portal_settings_rev?: number | null } | null;
    body = <PortalSettingsForm initial={(row?.portal_settings ?? {}) as never} rev={row?.portal_settings_rev ?? 0} canEdit={ctx.can("portal.settings")} />;
  } else {
    const [{ data: products }, { data: variants }] = await Promise.all([
      supabase.from("products").select("id, name, status, portal_enabled, portal_settings").eq("workspace_id", workspace.id).is("archived_at", null),
      supabase.from("product_variants").select("id, product_id, name, portal_settings").eq("workspace_id", workspace.id).is("archived_at", null),
    ]);
    const p = (products ?? []) as unknown as ProgramProductRow[];
    const v = (variants ?? []) as unknown as ProgramVariantRow[];
    const cards = programCards(p, v);
    if (ctx.can("portal.sections")) right = <AddProgramDialog products={addableProducts(p, v)} />;
    // Las métricas de las cards (F108), en una consulta, con services.view o program.manage.
    const days = parseMetricDays(sp.dias);
    const canMetrics = ctx.can("services.view") || ctx.can("program.manage");
    const metrics = canMetrics && cards.length ? await svcRpc<Record<string, CardMetrics>>(supabase, "program_card_metrics", { p_product_ids: cards.map((c) => c.id), p_days: days }) : null;
    const byProduct = metrics?.ok ? metrics.data ?? {} : {};
    body =
      cards.length === 0 ? (
        <EmptyHint>Todavía no hay programas en el portal. Agregá uno: elegís el producto y qué variantes tienen acceso.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {canMetrics && (
            <nav className="flex gap-1 text-xs" aria-label="Período de las métricas">
              {([7, 30] as const).map((d) => (
                <Link key={d} href={`/dashboard/portal?tab=programas&dias=${d}`} aria-current={d === days ? "page" : undefined} className={cn("rounded-full border px-3 py-1", d === days ? "border-primary-edge bg-primary/10" : "border-border hover:bg-accent")}>
                  Últimos {d} días
                </Link>
              ))}
            </nav>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.id} className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
                <Link href={`/dashboard/portal/${c.id}`} className="block hover:underline">
                  <p className="text-sm font-semibold text-foreground">{c.name}</p>
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.variantsWithAccess} de {c.variantsTotal} variantes con acceso
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{c.sectionsOn.join(" · ") || "Sin secciones prendidas"}</p>
                {canMetrics && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {cardMetricViews(c.id, byProduct[c.id]).map((m) => (
                      <div key={m.key} className="flex items-baseline justify-between gap-2">
                        <dt className="text-muted-foreground">{m.label}</dt>
                        <dd className={cn("font-medium", m.highlight && "text-warn")}>{m.href ? <Link href={m.href} className="hover:underline">{m.value}</Link> : m.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </div>
      );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/portal" right={right} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 md:px-8">
          <nav className="flex gap-1 border-b border-border" aria-label="Secciones del Portal">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={`/dashboard/portal?tab=${t.key}`}
                aria-current={t.key === tab.key ? "page" : undefined}
                className={cn("-mb-px border-b-2 px-3 py-2 text-sm", t.key === tab.key ? "border-primary-edge text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {body}
        </div>
      </div>
    </div>
  );
}
