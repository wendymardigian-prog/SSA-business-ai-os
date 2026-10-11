import type { Metadata } from "next";
import { AttributionTracker } from "@/components/attribution/attribution-tracker";
import { brandLogoUrl, brandName } from "@/lib/brand";

/**
 * El layout de las páginas públicas del propio proyecto: lo que va alrededor de
 * cada página de `app/(sitio)/` (la home y las que se armen a pedido).
 *
 *  - Encabezado con el logo y el nombre de la marca (`lib/brand.ts`) y pie simple.
 *  - `AttributionTracker`: anota de dónde vino la persona (UTM, ids de clic) en la
 *    cookie `ssa_attr`, para que un formulario que llene en OTRA página conserve
 *    esos datos.
 *  - Nada del dashboard: no lee la sesión (las páginas pueden ser estáticas).
 *
 * Cada clon reemplaza esto por su propio diseño; la versión por defecto de la
 * plantilla vive en `scripts/template-files/sitio/`. Ver `docs/sitio.md`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const name = brandName();
  return {
    openGraph: { siteName: name, type: "website", locale: "es" },
  };
}

export default function SitioLayout({ children }: { children: React.ReactNode }) {
  const name = brandName();
  const logo = brandLogoUrl();
  return (
    <div className="flex min-h-dvh flex-col">
      <AttributionTracker />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={name} className="h-8 w-auto" />
          ) : null}
          <span className="text-base font-semibold">{name}</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-4 py-4 text-xs text-muted-foreground">© {new Date().getFullYear()} {name}</div>
      </footer>
    </div>
  );
}
