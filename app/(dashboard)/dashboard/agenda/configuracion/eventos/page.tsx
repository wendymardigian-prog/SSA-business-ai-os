import { ConfigShell } from "@/components/scheduling/config-shell";

export const dynamic = "force-dynamic";

/** Eventos: se construye en el Bloque 3 de la Etapa 4. La seccion existe para que la navegacion este completa. */
export default function AgendaConfigEventosPage() {
  return (
    <ConfigShell route="/dashboard/agenda/configuracion/eventos">
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Esta sección se construye en el Bloque 3 de la Etapa 4.
      </div>
    </ConfigShell>
  );
}
