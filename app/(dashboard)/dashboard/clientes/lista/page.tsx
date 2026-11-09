// @plantilla-quitar(servicios)
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { svcSchema } from "@/lib/services/db";
import { contactNames } from "@/lib/services/screens/load-services";
import { clientRows, paidByContact } from "@/lib/services/screens/clients";
import { formatPriceUsd } from "@/lib/content/taxonomy";
import { PageHeader } from "@/components/page-header";
import { ClientesTabs } from "@/components/services/clients/clientes-tabs";

/** Clientes › Clientes (F27): una fila por contacto con al menos un servicio que la persona ve (la RLS lo decide). */
export default async function ClientesListaPage() {
  const ctx = await requirePermission("services.view");
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.clientes", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const { data } = await svcSchema(supabase).from("services").select("contact_id, status, sale_id").eq("workspace_id", workspace.id).limit(5000);
  const rows = clientRows(((data ?? []) as Array<{ contact_id: string; status: never; sale_id: string | null }>).map((r) => ({ contactId: r.contact_id, status: r.status, saleId: r.sale_id })));
  const saleIds = rows.flatMap((r) => r.saleIds);
  const [names, pays, last] = await Promise.all([
    contactNames(supabase, rows.map((r) => r.contactId)),
    saleIds.length ? supabase.from("payments").select("sale_id, amount").in("sale_id", saleIds).eq("status", "paid") : Promise.resolve({ data: [] }),
    rows.length ? supabase.from("contacts").select("id, last_interaction_at").in("id", rows.map((r) => r.contactId)) : Promise.resolve({ data: [] }),
  ]);
  const paid = paidByContact(rows, ((pays.data ?? []) as Array<{ sale_id: string; amount: number }>).map((p) => ({ saleId: p.sale_id, amount: Number(p.amount) })));
  const lastBy = new Map(((last.data ?? []) as Array<{ id: string; last_interaction_at: string | null }>).map((c) => [c.id, c.last_interaction_at]));
  const sorted = [...rows].sort((a, b) => (names.get(a.contactId) ?? "").localeCompare(names.get(b.contactId) ?? ""));

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/clientes/lista" tabs={<ClientesTabs active="clientes" />} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-4 p-4 md:p-6">
          {sorted.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Todavía no hay clientes con servicios.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Servicios</th>
                    <th className="px-3 py-2 font-medium">Total cobrado</th>
                    <th className="px-3 py-2 font-medium">Último contacto</th>
                    <th className="px-3 py-2 font-medium">Portal</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.contactId} className="border-t border-border hover:bg-accent/30">
                      <td className="px-3 py-2">
                        <Link href={`/dashboard/clientes/c/${r.contactId}`} className="font-medium hover:underline">
                          {names.get(r.contactId) ?? "Sin nombre"}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.servicesLabel}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatPriceUsd(paid.get(r.contactId) ?? 0)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{lastBy.get(r.contactId)?.slice(0, 10).split("-").reverse().join("/") ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">Sin portal</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
