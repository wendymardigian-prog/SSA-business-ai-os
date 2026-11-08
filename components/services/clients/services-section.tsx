// @plantilla-quitar(servicios)
"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { LIGHT_LABELS, STATUS_LABELS, type Light, type ServiceStatus } from "@/lib/services/screens/list";
import { LightDot } from "./services-list-view";
import { NewServiceDialog, type NewServiceOptions } from "./new-service-dialog";

export interface SectionService {
  id: string;
  label: string;
  status: ServiceStatus;
  light: Light | null;
  phaseName: string | null;
}

/**
 * «Servicios» en la ficha del contacto y «Servicio» en la ficha de la venta (F33): cada uno con su link y, sin
 * servicio, «+ Servicio». Las secciones de BAIOS no cambian: esta se suma solo con el módulo prendido.
 */
export function ServicesSection({
  title,
  services,
  canCreate,
  options,
  preset,
  openOnMount = false,
}: {
  title: string;
  services: SectionService[];
  canCreate: boolean;
  options: NewServiceOptions;
  preset: { contactId: string; contactName: string; saleId?: string; variantId?: string };
  openOnMount?: boolean;
}) {
  const [creating, setCreating] = useState(openOnMount && canCreate && services.length === 0);
  return (
    <section aria-label={title} className="rounded-xl border border-border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {canCreate && (services.length === 0 || !preset.saleId) && (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-accent">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Servicio
          </button>
        )}
      </div>
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">{preset.saleId ? "Esta venta todavía no tiene servicio." : "Este contacto no tiene servicios."}</p>
      ) : (
        <ul className="space-y-1.5">
          {services.map((s) => (
            <li key={s.id}>
              <Link href={`/dashboard/clientes/s/${s.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/40">
                <LightDot light={s.light ?? "gray"} label={LIGHT_LABELS[s.light ?? "gray"]} />
                <span className="flex-1 truncate font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">
                  {STATUS_LABELS[s.status]}
                  {s.phaseName ? ` · ${s.phaseName}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewServiceDialog options={options} preset={preset} onClose={() => setCreating(false)} />}
    </section>
  );
}
