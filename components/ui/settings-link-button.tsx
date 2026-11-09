import Link from "next/link";
import { Settings } from "lucide-react";

/**
 * El botón de ajustes (⚙) de la barra superior: lleva a la pantalla de ajustes de la sección. Mismo aspecto que el
 * de Contenido (`components/content/content-settings-button.tsx`). Va en el `right` del `PageHeader`, a la izquierda
 * del botón principal. La página no lo dibuja a quien no puede ver esos ajustes.
 */
export function SettingsLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Settings className="h-4 w-4" aria-hidden />
    </Link>
  );
}
