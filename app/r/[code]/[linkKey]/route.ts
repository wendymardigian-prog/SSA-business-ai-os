// @plantilla-quitar(ventas)
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "@/lib/app-url";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { requestIp } from "@/lib/antispam/client-ip";
import { hashIp } from "@/lib/scheduling/antispam";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveShortLink, SHORT_LINK_CLICKS_PER_MINUTE, type ShortLinkProduct } from "@/lib/affiliates/short-link";
import type { ProductLinks } from "@/lib/affiliates/product-links";

/**
 * `GET /r/<código>/<linkKey>`: el link corto de un afiliado (F73). Redirige al link del producto con `?ref=` y las
 * UTM; la asignación la hace el toque que deja la página de destino (trigger de la 00343), no esta ruta. Pública, sin
 * sesión, con tope por IP y `noindex`. Nunca da 500: lo que no se puede resolver cae a la app. No se loguea el código.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer-when-downgrade" } as const;

export async function GET(request: Request, { params }: { params: Promise<{ code: string; linkKey: string }> }) {
  const fallback = appUrl();
  try {
    const { code, linkKey } = await params;
    const service = await createServiceClient();
    const ip = requestIp(request.headers) ?? "unknown";
    const limit = await checkLimit(service, { key: `affiliates:r:${hashIp(ip)}`, max: SHORT_LINK_CLICKS_PER_MINUTE, windowMs: 60_000 });
    if (!limit.allowed) {
      return new NextResponse("Demasiados pedidos. Probá de nuevo en un minuto.", { status: 429, headers: { ...HEADERS, "Retry-After": "60" } });
    }
    const db = service as unknown as SupabaseClient<any, any, any>;
    const result = await resolveShortLink(code, linkKey, {
      today: new Date().toISOString().slice(0, 10),
      async productsWithKey(key) {
        const { data } = await db.from("products").select("id, workspace_id, name, status, links").contains("links", { items: [{ key }] });
        return ((data ?? []) as Array<{ id: string; workspace_id: string; name: string; status: string; links: ProductLinks }>)
          .slice(0, 5)
          .map((p): ShortLinkProduct => ({ id: p.id, workspaceId: p.workspace_id, name: p.name, active: p.status === "active", links: p.links }));
      },
      async workspacesWithCode(c, workspaceIds) {
        const [members, contacts] = await Promise.all([
          db.from("workspace_members").select("workspace_id").eq("affiliate_code", c).in("workspace_id", workspaceIds),
          db.from("contacts").select("workspace_id").eq("affiliate_code", c).in("workspace_id", workspaceIds),
        ]);
        return [...((members.data ?? []) as Array<{ workspace_id: string }>), ...((contacts.data ?? []) as Array<{ workspace_id: string }>)].map((r) => r.workspace_id);
      },
    });
    return NextResponse.redirect(result.status === "redirect" ? result.url : fallback, { status: 302, headers: HEADERS });
  } catch {
    return NextResponse.redirect(fallback, { status: 302, headers: HEADERS });
  }
}
