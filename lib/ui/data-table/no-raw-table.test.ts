/**
 * Una tabla nueva se arma con `DataTable` (components/ui/data-table), no con un `<table>` a mano: así todas tienen las mismas
 * columnas ajustables (prender y apagar, reordenar, fijar, ancho), los mismos totales y las mismas vistas guardadas.
 * Ver docs/tablas.md.
 *
 * `LEGACY` son las tablas que todavía no se migraron. Al migrar una, se saca de la lista (el test también falla si una
 * tabla de la lista ya no tiene `<table>`: la lista tiene que ser honesta). Sumar acá una tabla nueva es hacer trampa: usá `DataTable`.
 * Las tablas chicas de solo lectura de un panel (una grilla de 3 filas dentro de un diálogo) también cuentan: si no necesitan
 * columnas ajustables, es la excepción y se anota acá con su motivo.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LEGACY = [
  "app/(dashboard)/dashboard/(comunicacion)/comentarios/page.tsx",
  "app/(dashboard)/dashboard/afiliados/page.tsx", // @plantilla-quitar(ventas)
  "app/(dashboard)/dashboard/clientes/lista/page.tsx", // @plantilla-quitar(servicios)
  "app/(dashboard)/dashboard/contacts/contacts-view.tsx",
  "app/(dashboard)/dashboard/contacts/import/import-view.tsx",
  "app/(dashboard)/dashboard/settings/custom-fields/custom-fields-view.tsx",
  "app/(dashboard)/dashboard/settings/estados/statuses-view.tsx",
  "components/agents/actions-tab.tsx",
  "components/agents/costs-tab.tsx",
  "components/agents/runs-screen.tsx",
  "components/agents/tasks/calls/prompt-test-panel.tsx", // @plantilla-quitar(llamadas)
  "components/assignment/assignment-tester.tsx",
  "components/calls/calls-list.tsx", // @plantilla-quitar(llamadas)
  "components/channels/whatsapp-daily-chart.tsx",
  "components/commissions/adjustment-dialog.tsx", // @plantilla-quitar(comisiones)
  "components/commissions/commissions-list.tsx", // @plantilla-quitar(comisiones)
  "components/commissions/payout-dialog.tsx", // @plantilla-quitar(comisiones)
  "components/content/drawer/piece-performance.tsx",
  "components/content/list-view.tsx",
  "components/dashboards/ads/crm-table.tsx",
  "components/dashboards/ads/daily-table.tsx",
  "components/dashboards/agenda/agenda-dashboard.tsx",
  "components/dashboards/calls/calls-dashboard.tsx", // @plantilla-quitar(llamadas)
  "components/dashboards/chat/team-block.tsx",
  "components/dashboards/group-table.tsx",
  "components/dashboards/posts-table.tsx",
  "components/dashboards/unified-dashboard.tsx",
  "components/designer/generate/generations-tab.tsx", // @plantilla-quitar(disenador)
  "components/drafts/metrics-strip.tsx",
  "components/eod/reports/reports-view.tsx", // @plantilla-quitar(formularios)
  "components/finance/expenses-list.tsx", // @plantilla-quitar(finanzas)
  "components/finance/recurring-list.tsx", // @plantilla-quitar(finanzas)
  "components/finance/summary-dashboard.tsx", // @plantilla-quitar(finanzas)
  "components/finance/vendors-list.tsx", // @plantilla-quitar(finanzas)
  "components/flows/runs/flow-runs-screen.tsx",
  "components/forms/editor/contact-tab.tsx", // @plantilla-quitar(formularios)
  "components/forms/editor/prefill-card.tsx", // @plantilla-quitar(formularios)
  "components/forms/responses/metrics-view.tsx", // @plantilla-quitar(formularios)
  "components/forms/responses/response-groups.tsx", // @plantilla-quitar(formularios)
  "components/forms/responses/responses-table.tsx", // @plantilla-quitar(formularios)
  "components/inbox/assignment/known-assignment-view.tsx",
  "components/sales/payment-plan.tsx", // @plantilla-quitar(ventas)
  "components/sales/wizard/step3-financing.tsx", // @plantilla-quitar(ventas)
  "components/scheduling/bookings/list.tsx",
  "components/services/clients/import-services-view.tsx", // @plantilla-quitar(servicios)
  "components/services/clients/service-accesses-panel.tsx", // @plantilla-quitar(servicios)
  "components/services/clients/services-list-view.tsx", // @plantilla-quitar(servicios)
  "components/services/portal/program-calendar.tsx", // @plantilla-quitar(servicios)
  "components/services/portal/review-list.tsx", // @plantilla-quitar(servicios)
  "components/services/products/service-product-page.tsx", // @plantilla-quitar(servicios)
  "components/services/products/variant-portal-panel.tsx", // @plantilla-quitar(servicios)
  "components/settings/finance-categories-card.tsx", // @plantilla-quitar(finanzas)
  "components/settings/integrations/website-screen.tsx", // @plantilla-quitar(formularios)
  "components/settings/payment-methods-card.tsx", // @plantilla-quitar(ventas)
  "components/settings/roles/channel-access-section.tsx",
  "components/tasks/tasks-table.tsx", // @plantilla-quitar(tareas)
  "components/webhooks/endpoint-detail.tsx", // @plantilla-quitar(webhooks)
  "components/webhooks/inbound-drawer.tsx", // @plantilla-quitar(webhooks)
  "components/webhooks/webhooks-screen.tsx", // @plantilla-quitar(webhooks)
] as const;

const ROOT = process.cwd();
const SELF = "components/ui/data-table/data-table.tsx";

function tsxFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? tsxFiles(rel) : name.endsWith(".tsx") ? [rel] : [];
  });
}

const withTable = [...tsxFiles("components"), ...tsxFiles("app")].filter((f) => /<table[\s>]/.test(readFileSync(join(ROOT, f), "utf8")));

describe("tablas con columnas", () => {
  it("una tabla nueva usa DataTable, no un <table> a mano", () => {
    const offenders = withTable.filter((f) => f !== SELF && !(LEGACY as readonly string[]).includes(f));
    expect(offenders, "Armá la tabla con DataTable (docs/tablas.md) en vez de un <table> a mano.").toEqual([]);
  });

  it("la lista de tablas heredadas es honesta: ninguna ya migrada", () => {
    const stale = LEGACY.filter((f) => !withTable.includes(f));
    expect(stale, "Estas tablas ya no tienen <table>: sacalas de LEGACY.").toEqual([]);
  });

  // @plantilla-desde(ventas)
  it("Ventas y Pagos ya usan DataTable", () => {
    for (const file of ["components/sales/sales-list.tsx", "components/sales/payments-list.tsx"]) {
      expect(readFileSync(join(ROOT, file), "utf8")).toContain("<DataTable");
    }
  });
  // @plantilla-hasta(ventas)
});
