/**
 * Lo común a la tarjeta de un evento y de un formulario: arma los datos con la marca del
 * negocio, las etiquetas de la página y la respuesta de la ruta de la imagen. Solo de servidor.
 */
import type { Metadata } from "next";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { resolveBrand, type Brand, type WorkspaceBrandFields } from "@/lib/brand";
import { publicBaseUrl, type WorkspaceDomainSource } from "@/lib/public-url";
import { clientIp, hashIp } from "@/lib/scheduling/antispam";
import { createServiceClient } from "@/lib/supabase/server";
import { OG_IMAGE_SIZE, renderShareImage } from "./image";
import { shareVersion, type ShareText } from "./text";

/** Las columnas del workspace que necesita una tarjeta. */
export const SHARE_WORKSPACE_COLUMNS = "brand_name, brand_logo_path, brand_color, scheduling_public_base_url";

const IMAGES_PER_MINUTE = 120;

export interface ShareData extends ShareText {
  brand: Brand;
  /** La dirección de la página, sin parámetros: un link firmado no cambia la tarjeta. */
  pageUrl: string;
  version: string;
}

export function buildShareData(workspace: WorkspaceBrandFields & NonNullable<WorkspaceDomainSource>, path: string, text: ShareText): ShareData {
  const brand = resolveBrand(workspace);
  return {
    ...text,
    brand,
    pageUrl: `${publicBaseUrl(workspace)}${path}`,
    version: shareVersion([text.imageTitle, text.imageSubtitle, brand.name, brand.logoUrl, brand.colorHex]),
  };
}

/** Las etiquetas que leen WhatsApp y las redes. La imagen vive al lado de la página, en su mismo dominio. */
export function shareMetadata(share: ShareData): Pick<Metadata, "openGraph" | "twitter"> {
  const image = `${share.pageUrl}/preview.png?v=${share.version}`;
  const description = share.description ? { description: share.description } : {};
  return {
    openGraph: {
      type: "website",
      url: share.pageUrl,
      siteName: share.brand.name,
      title: share.title,
      ...description,
      images: [{ url: image, ...OG_IMAGE_SIZE, type: "image/png", alt: share.title }],
    },
    twitter: { card: "summary_large_image", title: share.title, ...description, images: [image] },
  };
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * La respuesta de una ruta `preview.png`. Pública, sin sesión y con tope por IP. Lo que no
 * está disponible es 404. Cachea un día: si cambia lo que se dibuja, la URL trae otra versión.
 */
export async function shareImageResponse(request: Request, load: (service: ServiceClient) => Promise<ShareData | null>): Promise<Response> {
  const noStore = { "Cache-Control": "no-store" };
  try {
    const service = await createServiceClient();
    const limit = await checkLimit(service, { key: `og:image:${hashIp(clientIp(request.headers))}`, max: IMAGES_PER_MINUTE, windowMs: 60_000 });
    if (!limit.allowed) return new Response(null, { status: 429, headers: { ...noStore, "Retry-After": "60" } });

    const share = await load(service);
    if (!share) return new Response(null, { status: 404, headers: noStore });

    const image = await renderShareImage({ brand: share.brand, title: share.imageTitle, subtitle: share.imageSubtitle });
    return new Response(Buffer.from(image), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
  } catch (error) {
    console.error("[vista previa] no pude armar la imagen:", error instanceof Error ? error.message : String(error));
    return new Response(null, { status: 503, headers: noStore });
  }
}
