import { serveDownload } from "@/lib/designer/public/serve";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Descargar un diseño publicado (F44): `/d/<código>/descargar?formato=pdf|zip|png&pagina=N`.
 * Verifica que esté publicado (o sea una generación válida) y que la descarga esté permitida; responde el
 * archivo por streaming con un nombre legible. Si todavía no está, encola el render y responde 202. Con la
 * descarga apagada, 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await params;
  return serveDownload(await createServiceClient(), request, code);
}
