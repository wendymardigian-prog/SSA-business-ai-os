import Link from "next/link";
import { Webhook } from "lucide-react";

/**
 * La tarjeta de Integraciones para los webhooks entrantes (Extra L): cuántos endpoints hay
 * activos y un acceso a la pantalla. No pasa por el catálogo de proveedores: no tiene claves
 * propias que cargar (el secreto opcional es de cada endpoint).
 */
export function WebhooksCard({ active, paused }: { active: number; paused: number }) {
  return (
    <section aria-labelledby="webhooks-card-title" className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="webhooks-card-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <Webhook className="h-4 w-4" aria-hidden /> Webhooks entrantes
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Una URL por cada formulario externo (Typeform, Tally, Framer…). Lo que llega se guarda y tus automatizaciones crean o actualizan el contacto.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${active > 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          {active === 0 ? "Sin endpoints" : `${active} ${active === 1 ? "activo" : "activos"}`}
        </span>
      </div>
      {paused > 0 && <p className="mt-2 text-xs text-muted-foreground">{paused} {paused === 1 ? "pausado" : "pausados"}.</p>}
      <Link href="/dashboard/settings/integrations/webhooks" className="mt-3 inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent">
        {active + paused === 0 ? "Crear un endpoint" : "Administrar webhooks"}
      </Link>
    </section>
  );
}
