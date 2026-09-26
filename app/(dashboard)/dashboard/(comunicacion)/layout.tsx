/**
 * El marco de las pantallas de comunicacion.
 *
 * (comunicacion) es un route group: los parentesis agrupan carpetas sin entrar
 * en la URL, asi que /dashboard/inbox, /dashboard/broadcasts,
 * /dashboard/sequences y /dashboard/growth siguen siendo exactamente las
 * mismas direcciones de antes.
 *
 * Las sub-pestañas ya no se dibujan aca: desde F7 cada pantalla empieza con su
 * barra superior y las pestañas van justo debajo, dentro del contenido. Si el
 * layout las pusiera arriba, quedarian ENCIMA de la barra de la pagina.
 *
 * min-h-0: las cuatro pantallas son de alto completo (la bandeja scrollea
 * adentro, no la pagina). Sin min-h-0 el hijo no se deja achicar y el pie se
 * va fuera de la pantalla.
 */
export default function ComunicacionLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}
