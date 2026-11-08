import { servePreview } from "@/lib/designer/public/serve";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * La imagen de la tarjeta al compartir el link: la página 1 de los archivos de publicar o, si todavía no hay,
 * la imagen generada con la marca del negocio. Pública y con tope por IP; lo que no se puede ver es 404.
 * La terminación `.png` evita el middleware de sesión.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await params;
  return servePreview(await createServiceClient(), request, code);
}
