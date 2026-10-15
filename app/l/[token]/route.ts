import { after, NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { LINK_CLICKS_PER_MINUTE, resolveLinkClick } from "@/lib/attribution/link-click";
import { readAttributionLinkSecret } from "@/lib/attribution/link-secret";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { hashIp } from "@/lib/scheduling/antispam";
import { recordTouch } from "@/lib/contacts/touch";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * `GET /l/<token>`: un link con seguimiento de un mensaje (Extra I, F40). Registra el clic como un toque y redirige al
 * destino que viene FIRMADO adentro del token (no hay `?to=`: no es un open redirect). Pública, sin sesión.
 *
 * Nunca da 500: lo que no se puede leer cae a la URL de la app. Los previsualizadores de links (WhatsApp, Instagram,
 * Facebook, Slack…) se redirigen sin registrar nada. El toque se anota DESPUÉS de responder, sin demorar la redirección.
 * No se loguea el token.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer-when-downgrade" } as const;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const fallback = appUrl();
  try {
    const { token } = await params;
    const service = await createServiceClient();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

    const result = await resolveLinkClick(
      { token, userAgent: request.headers.get("user-agent"), ip },
      {
        readSecret: (workspaceId) => readAttributionLinkSecret(service, workspaceId),
        limit: (clientIp) => checkLimit(service, { key: `links:click:${hashIp(clientIp)}`, max: LINK_CLICKS_PER_MINUTE, windowMs: 60_000 }),
        fallbackUrl: fallback,
      },
    );

    if (result.status === 429 || !result.location) {
      return new NextResponse("Demasiados pedidos. Probá de nuevo en un minuto.", { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    }
    if (result.touch) {
      const { workspaceId, contactId, input } = result.touch;
      after(async () => {
        try {
          await recordTouch(service, { workspaceId, contactId, touch: input });
        } catch (error) {
          console.error("[atribucion] no pude anotar el clic de un link:", error instanceof Error ? error.message : String(error));
        }
      });
    }
    return NextResponse.redirect(result.location, { status: 302, headers: NO_STORE });
  } catch {
    return NextResponse.redirect(fallback, { status: 302, headers: NO_STORE });
  }
}
