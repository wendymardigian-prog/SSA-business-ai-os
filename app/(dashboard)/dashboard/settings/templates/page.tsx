import { redirect } from "next/navigation";

/**
 * Las respuestas rapidas (F17) se unificaron con la banca de audios en
 * /dashboard/settings/recursos. Esta ruta solo redirige: el link que alguien
 * tenga guardado o un marcador viejo siguen funcionando.
 */
export default function TemplatesRedirectPage() {
  redirect("/dashboard/settings/recursos");
}
