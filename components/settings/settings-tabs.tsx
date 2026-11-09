"use client";

import { usePathname } from "next/navigation";
import { HeaderTabs } from "@/components/ui/header-tabs";
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
 * Van en la barra superior (`<PageHeader tabs={<SettingsTabs />} />`), con el
 * control de pestañas de siempre (`HeaderTabs`): en el celular `PageHeader`
 * las baja a su fila, que se desplaza de costado.
 */
export function SettingsTabs() {
  const pathname = usePathname() ?? "";
  const active = activeSettingsTab(pathname);

  return (
    <HeaderTabs
      label="Secciones de ajustes"
      active={active}
      items={SETTINGS_TABS.map((tab) => ({ key: tab.href, label: tab.name, href: tab.href }))}
    />
  );
}
