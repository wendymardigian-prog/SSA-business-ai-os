import { Suspense } from "react";
import { loadSiteForm } from "@/lib/forms/site-load";
import { isAvailable } from "@/lib/forms/public-client";
import { SiteForm } from "./site-form";
import { cn } from "@/lib/utils";

/**
 * `<Formulario slug="aplicacion" />` para cualquier página del sitio (F31).
 *
 *  - Server Component: lee la definición con `get_public_form` (lista blanca) con caché por
 *    etiqueta `form:<slug>`; publicar, pausar o archivar la invalida.
 *  - Dibuja el MISMO `PublicForm` que `/f/<slug>`, en modo `site` (sin el marco de página).
 *  - `prefill` (valores fijados por el código) gana sobre los parámetros de la URL.
 *  - Si el formulario no está disponible, muestra un aviso DENTRO de la página: no la rompe
 *    ni da 404.
 *  - Varios en la misma página funcionan cada uno por su lado.
 *
 * `variant="card"` lo pone en una tarjeta; `"plain"`, sin marco.
 */
export async function Formulario({
  slug,
  prefill,
  variant = "card",
  className,
}: {
  slug: string;
  prefill?: Record<string, string | number>;
  variant?: "card" | "plain";
  className?: string;
}) {
  const form = await loadSiteForm(slug);
  const frame = cn(variant === "card" && "rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8", className);

  if (!isAvailable(form)) {
    return (
      <div role="status" className={cn(frame, "text-center text-sm text-muted-foreground")}>
        Este formulario no está disponible por ahora.
      </div>
    );
  }

  return (
    <div className={frame}>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-muted" aria-hidden />}>
        <SiteForm form={form} prefill={prefill} />
      </Suspense>
    </div>
  );
}
