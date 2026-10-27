"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Section } from "./ui";
import { StatusChip } from "@/components/sales/sales-list";
import { SaleWizard } from "@/components/sales/wizard/sale-wizard";
import type { WizardConfig } from "@/components/sales/wizard/types";
import { formatMoney } from "@/lib/shared/format";

export interface ContactSaleRow {
  id: string;
  saleDate: string;
  status: string;
  finalAmount: number;
  product: string;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Las ventas de este contacto (Ventas, B3). Lo que se ve lo decide la RLS (`can_see_sale`).
 * Con `sales.manage` y un catálogo vendible, «Nueva venta» abre el asistente con el contacto
 * ya resuelto.
 */
export function ContactSalesSection({
  sales,
  total,
  contact,
  wizard,
  paymentHealth,
  interest,
}: {
  sales: ContactSaleRow[];
  total: number;
  contact: { id: string; name: string };
  /** Null si la persona no puede cargar ventas (sin `sales.manage`) o no hay catálogo. */
  wizard: WizardConfig | null;
  /** «7 pagos: 5 puntuales, 2 tarde · promedio +3 días · sin mora activa», o null si no hay nada que decir. */
  paymentHealth?: string | null;
  /** El producto de interés del contacto (00246): «Nueva venta» arranca con él elegido. */
  interest?: { productId: string | null; variantId: string | null };
}) {
  const [open, setOpen] = useState(false);
  if (sales.length === 0 && !wizard) return null;
  return (
    <Section title="Ventas">
      {wizard && (
        <div className="mb-2">
          <button type="button" onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent">
            <Plus className="h-3.5 w-3.5" aria-hidden /> Nueva venta
          </button>
        </div>
      )}
      {paymentHealth && <p className="mb-2 rounded-lg bg-muted/40 px-3 py-2 text-xs" title="Salud de pago">Salud de pago: {paymentHealth}</p>}
      {sales.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este contacto todavía no tiene ventas.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {sales.map((s) => (
            <li key={s.id}>
              <Link href={`/dashboard/ventas/${s.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-muted/30">
                <span className="min-w-0 flex-1 truncate font-medium">{s.product}</span>
                <span className="text-xs text-muted-foreground">{formatDate(s.saleDate)}</span>
                <span className="tabular-nums">{formatMoney(s.finalAmount)}</span>
                <StatusChip status={s.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > sales.length && (
        <p className="pt-2 text-sm">
          <Link href={`/dashboard/ventas?q=${encodeURIComponent(contact.name)}`} className="text-primary underline-offset-2 hover:underline">Ver todas ({total})</Link>
        </p>
      )}
      {open && wizard && <SaleWizard config={wizard} initial={{ contact, productId: interest?.productId ?? null, variantId: interest?.variantId ?? null }} onClose={() => setOpen(false)} />}
    </Section>
  );
}
