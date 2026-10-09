import { redirect } from "next/navigation";

/**
 * Esta pestaña se llamaba "Contenido" (pilares y ofertas). Ahora los productos
 * viven en /dashboard/settings/productos y los pilares, en la pagina de
 * Contenido, detras del boton de ajustes. Esta ruta solo redirige: un marcador
 * o un link viejo siguen funcionando.
 */
export default function ContenidoSettingsRedirectPage() {
  redirect("/dashboard/settings/productos");
}
