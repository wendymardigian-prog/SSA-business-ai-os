import Link from "next/link";
import { Globe } from "lucide-react";

/**
 * La tarjeta de Integraciones para la web del negocio: cuántas direcciones tienen permiso
 * para mandar formularios desde otro dominio (00277), y el acceso a la pantalla.
 */
export function WebsiteCard({ origins }: { origins: number }) {
  return (
    <section aria-labelledby="website-card-title" className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="website-card-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <Globe className="h-4 w-4" aria-hidden /> Tu sitio web
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Tu propia web manda sus formularios a este sistema. Elegís desde qué direcciones, y tenés la guía para conectarla.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${origins > 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          {origins === 0 ? "Sin conectar" : `${origins} ${origins === 1 ? "dirección" : "direcciones"}`}
        </span>
      </div>
      <Link href="/dashboard/settings/integrations/sitio-web" className="mt-3 inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent">
        {origins === 0 ? "Conectar tu web" : "Administrar"}
      </Link>
    </section>
  );
}
