import { SectionTabs } from "@/components/comunicacion/section-tabs";

/**
 * El marco de las pantallas de comunicacion: la barra de sub-pestañas arriba y
 * la pantalla abajo.
 *
 * (comunicacion) es un route group: los parentesis agrupan carpetas sin entrar
 * en la URL, asi que /dashboard/inbox, /dashboard/broadcasts,
 * /dashboard/sequences y /dashboard/growth siguen siendo exactamente las mismas
 * direcciones de antes.
 *
 * min-h-0 en el contenedor del hijo: las cuatro pantallas son de alto completo
 * (la bandeja scrollea adentro, no la pagina). Sin min-h-0 el hijo no se deja
 * achicar y la barra de pestañas empuja el pie fuera de la pantalla.
 */
export default function ComunicacionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionTabs />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
