/**
 * En una tabla, el nombre del contacto nunca es un link (18/11/2026): la fila entera abre el registro de la fila
 * (`useRowOpen`, `ClickableTr`, `rowHref` de `DataTable`) y un link al contacto adentro competiría con ese clic.
 * En las listas donde la fila ES la persona (Contactos, Inscriptos de una secuencia, Afiliados) la ficha es el destino
 * de la fila, pasado como `href` a `ClickableTr`/`ClickableBox`, nunca como `<Link>`. Ver docs/tablas.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TABLES = [
  "app/(dashboard)/dashboard/afiliados/page.tsx",
  "app/(dashboard)/dashboard/contacts/contacts-view.tsx",
  "components/agents/actions-tab.tsx",
  "components/agents/runs-screen.tsx",
  "components/calls/calls-list.tsx",
  "components/commissions/commissions-list.tsx",
  "components/flows/runs/flow-runs-screen.tsx",
  "components/forms/responses/responses-table.tsx",
  "components/sales/payments-list.tsx",
  "components/sales/sales-list.tsx",
  "components/sequences/enrollment-list.tsx",
  "components/services/clients/clients-list-view.tsx",
  "components/services/clients/services-list-view.tsx",
  "components/services/portal/program-projects.tsx",
];

// Un <Link> (o <a>) que apunta a la ficha de un contacto.
const CONTACT_LINK = /<(?:Link|a)\b[^>]*href=\{`\/dashboard\/contacts\/\$\{(\w+)/g;
// Fuera de la tabla, a propósito: el aviso «ese contacto ya existe» del diálogo de Contactos → Nuevo.
const ALLOWED = new Set(["duplicateId"]);

describe("el contacto no es un link en las tablas", () => {
  for (const file of TABLES) {
    it(file, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const hits = [...source.matchAll(CONTACT_LINK)].map((m) => m[1]).filter((name) => !ALLOWED.has(name));
      expect(hits, `${file} tiene un <Link> a la ficha de un contacto: usá texto y que la fila abra el registro`).toEqual([]);
    });
  }
});
