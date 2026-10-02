import { redirect } from "next/navigation";

/**
 * La banca de audios (F20) se unifico con las respuestas rapidas en
 * /dashboard/settings/recursos. Esta ruta solo redirige: el link que alguien
 * tenga guardado o un marcador viejo siguen funcionando.
 */
export default function AudiosRedirectPage() {
  redirect("/dashboard/settings/recursos");
}
