import { redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { canOpenConfig } from "@/lib/scheduling/config-sections";

export const dynamic = "force-dynamic";

/**
 * Configuracion de agenda (F8). Quien solo puede ver agendas (bookings.view)
 * no tiene nada que configurar: vuelve a Agendas. Cada seccion dibuja su
 * barra y la navegacion lateral con <ConfigShell>.
 */
export default async function AgendaConfigLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPermissionContext();
  if (!canOpenConfig(ctx.can)) redirect("/dashboard/agenda");
  return <>{children}</>;
}
