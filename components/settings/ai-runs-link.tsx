import Link from "next/link";
import { AI_RUNS_HREF } from "@/lib/settings/general-sections";

/**
 * Link a Corridas (S7), en la sección IA de General. Gateado por
 * `ai_costs.view` (D7), que se resuelve en el servidor (page.tsx) y llega
 * acá ya resuelto: este componente no decide permisos, solo los respeta.
 *
 * Es un componente aparte (y no JSX inline en settings-view.tsx) para poder
 * testear las dos ramas sin levantar toda la pantalla: `SettingsView` tiene
 * client components que usan `useRouter`/`usePathname` y no se pueden
 * renderizar con `renderToStaticMarkup` fuera del árbol de Next.
 */
export function AiRunsLink({ canView }: { canView: boolean }) {
  if (!canView) return null;

  return (
    <Link
      href={AI_RUNS_HREF}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
    >
      Ver corridas de IA →
    </Link>
  );
}
