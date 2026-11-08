// @plantilla-quitar(ventas)
import Link from "next/link";
import { requireAnyPermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { loadAffiliateSettings } from "@/lib/affiliates/load";
import { loadAffiliateSummary } from "@/lib/affiliates/load-summary";
import { AffiliateSettingsForm } from "@/components/affiliates/affiliate-settings-form";
import { AddExternalAffiliate } from "@/components/affiliates/add-external-affiliate";
import { EmptyHint } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "resumen", label: "Resumen", permission: "affiliates.view_all" },
  { key: "afiliados", label: "Afiliados", permission: "affiliates.view_all" },
  { key: "reglas", label: "Reglas", permission: "affiliates.settings" },
] as const;

const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;

/**
 * Afiliados (F105): Resumen por afiliado, la lista de afiliados (con el alta de uno externo) y las Reglas. Cada pestaña
 * pide su clave: el resumen y la lista `affiliates.view_all`, las reglas `affiliates.settings`. Las lecturas van con el
 * cliente de servicio DESPUÉS del permiso, filtradas por el negocio de la sesión.
 */
export default async function AfiliadosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireAnyPermission([
    "affiliates.view_all",
    "affiliates.settings",
  ]);
  const tabs = TABS.filter((t) => ctx.can(t.permission));
  const asked = (await searchParams).tab;
  const tab = tabs.find((t) => t.key === asked) ?? tabs[0];
  const service = await createServiceClient();

  let body: React.ReactNode = null;
  if (tab.key === "reglas") {
    const { settings, rev } = await loadAffiliateSettings(
      service,
      ctx.workspace.id,
    );
    body = (
      <AffiliateSettingsForm
        initial={settings}
        rev={rev}
        canEdit={ctx.can("affiliates.settings")}
      />
    );
  } else {
    const team = await getWorkspaceMembers(ctx.workspace.id);
    const { rows, totals } = await loadAffiliateSummary(
      service,
      ctx.workspace.id,
      team.map((m) => ({ userId: m.userId, name: m.name })),
      new Date().toISOString(),
    );
    if (tab.key === "resumen") {
      body =
        rows.length === 0 ? (
          <EmptyHint>
            Todavía no hay afiliados. Cada persona del equipo tiene su código en
            «Mis links», y podés sumar afiliados externos en la pestaña
            Afiliados.
          </EmptyHint>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Afiliado</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Referidos
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Los trajo
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Influyó</th>
                  <th className="px-3 py-2 text-right font-medium">Ventas</th>
                  <th className="px-3 py-2 text-right font-medium">Vendido</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Comisiones
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Por pagar
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={`${r.type}:${r.id}`}>
                    <td className="px-3 py-2 text-foreground">
                      {r.type === "contact" ? (
                        <Link
                          href={`/dashboard/contacts/${r.id}`}
                          className="hover:underline"
                        >
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.departed
                          ? "dado de baja"
                          : r.type === "user"
                            ? "equipo"
                            : "externo"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.leads}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.originated}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.influenced}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.sales}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {usd(r.salesCents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {usd(r.commissionsCents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {usd(r.pendingCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-medium">
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.leads}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.originated}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.influenced}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.sales}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(totals.salesCents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(totals.commissionsCents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(totals.pendingCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
    } else {
      body = (
        <div className="space-y-4">
          {ctx.can("affiliates.external") && <AddExternalAffiliate />}
          {rows.length === 0 ? (
            <EmptyHint>Todavía no hay afiliados con código.</EmptyHint>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {rows.map((r) => (
                <li
                  key={`${r.type}:${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="text-foreground">
                    {r.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {r.departed
                        ? "dado de baja"
                        : r.type === "user"
                          ? "equipo"
                          : "externo"}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.code ?? "sin código"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/afiliados" />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-8">
          <nav
            className="flex gap-1 border-b border-border"
            aria-label="Secciones de Afiliados"
          >
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={`/dashboard/afiliados?tab=${t.key}`}
                aria-current={t.key === tab.key ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm",
                  t.key === tab.key
                    ? "border-primary-edge text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
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
