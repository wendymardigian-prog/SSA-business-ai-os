import { redirect } from "next/navigation";
import { DEFAULT_CONFIG_SECTION } from "@/lib/scheduling/config-sections";

/** /configuracion abre la seccion por defecto (Eventos). */
export default function AgendaConfigIndex() {
  redirect(DEFAULT_CONFIG_SECTION.href);
}
