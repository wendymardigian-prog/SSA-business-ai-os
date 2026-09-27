import { ConfigShell } from "@/components/scheduling/config-shell";

export const dynamic = "force-dynamic";

/** Disponibilidad: se construye en el Bloque 2 de la Etapa 4. La seccion existe para que la navegacion este completa. */
export default function AgendaConfigDisponibilidadPage() {
  return (
    <ConfigShell route="/dashboard/agenda/configuracion/disponibilidad">
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Esta sección se construye en el Bloque 2 de la Etapa 4.
      </div>
    </ConfigShell>
  );
}
