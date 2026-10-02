"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { activeSettingsTab, SETTINGS_TABS } from "@/lib/settings/tabs";

/**
 * Las pestañas de Ajustes.
 *
 * Antes era una sola pagina larga con todo apilado y las secciones de equipo,
 * roles, campos personalizados, integraciones y la banca de recursos eran
 * tarjetas con un link o rutas sueltas sin pestaña (S1). Como pestañas, cada
 * cosa tiene su lugar y se llega en un clic.
 *
 * Son links y no estado: cada pestaña ya era una ruta propia, y asi se pueden
 * abrir en otra ventana y el navegador las precarga.
 *
 * "Equipo y roles" queda marcada tambien en /settings/roles, y "Recursos" en
 * /settings/templates y /settings/audios (que solo redirigen a /recursos):
 * son la misma idea y separarlas obligaria a adivinar en cual esta cada cosa.
 *
 * La lista y la regla de cual queda activa salen de lib/settings/tabs.ts, que
 * es la parte testeable sin React.
 *
 * La fila scrollea horizontal en vez de partirse en renglones: a 390px seis
 * pestañas no entran, y cortarlas a mitad de palabra es peor que un scroll
 * evidente.
 */
export function SettingsTabs() {
  const pathname = usePathname() ?? "";
  const active = activeSettingsTab(pathname);

  return (
    <nav
      aria-label="Secciones de ajustes"
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {SETTINGS_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab.href === active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.name}
        </Link>
      ))}
    </nav>
  );
}
