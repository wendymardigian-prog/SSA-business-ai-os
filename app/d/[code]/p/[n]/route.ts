import { servePageImage } from "@/lib/designer/public/serve";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * La imagen (PNG) de una página del link público: `/d/<código>/p/<n>` (n desde 1), a ×1 o ×2 según `?x=`.
 * Sale por streaming del bucket privado `design-renders` después de comprobar que el link la puede mostrar.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string; n: string }> }): Promise<Response> {
  const { code, n } = await params;
  return servePageImage(await createServiceClient(), request, code, n);
}
