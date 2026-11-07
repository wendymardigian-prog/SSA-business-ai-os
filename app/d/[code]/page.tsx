import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveBrand } from "@/lib/brand";
import { createServiceClient } from "@/lib/supabase/server";
import { publicBaseUrl } from "@/lib/public-url";
import { shareMetadata } from "@/lib/og/share";
import { designDownloadUrl } from "@/lib/designer/public-links";
import { padNotFound, startClock, withinPublicLimit } from "@/lib/designer/public/guard";
import { decidePublicView, publicTitle } from "@/lib/designer/public/model";
import { getPublicRecord } from "@/lib/designer/public/request";
import { designShare } from "@/lib/designer/public/share";
import { webPageHtml } from "@/lib/designer/public/web";
import { MobileDownloadBar, PieceImages, Preparing, PublicHeader, TooManyRequests, VerificationBox, WebFrame } from "@/components/designer/public/public-parts";

export const dynamic = "force-dynamic";

/** Título, descripción, robots y tarjeta (Open Graph). Todo sale de lo que muestra el link, nunca de más. */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const record = await getPublicRecord(code);
  if (!record) return { title: { absolute: "Diseño" }, robots: { index: false, follow: false } };
  const view = decidePublicView(record.pub);
  const share = designShare(record, view);
  return {
    title: { absolute: publicTitle(record.pub, view) },
    description: share.description,
    // `noindex` salvo una página web publicada con «Permitir que aparezca en buscadores».
    robots: view.indexable ? { index: true, follow: true } : { index: false, follow: false },
    ...shareMetadata(share),
  };
}

/**
 * El link público de un diseño (F43). Sin sesión. Lo que se muestra sale de `design_public_get`: un código que no
 * existe, un borrador o algo despublicado es un 404 (con un tiempo parecido, para no delatar cuál de los tres es).
 * Sin pie «Hecho con…»: es la marca del negocio, no la de la plataforma.
 */
export default async function DesignPublicPage({ params }: { params: Promise<{ code: string }> }) {
  const startedAt = startClock();
  const { code } = await params;
  const service = await createServiceClient();
  if (!(await withinPublicLimit(service, await headers(), "page"))) return <TooManyRequests />;

  const record = await getPublicRecord(code);
  if (!record) {
    await padNotFound(startedAt);
    notFound();
  }
  const { pub } = record;
  const view = decidePublicView(pub);
  const brand = resolveBrand(record.workspace);

  const option = view.download.ready ? view.download.option : null;
  const download = option
    ? { href: designDownloadUrl(publicBaseUrl(record.workspace), pub.code, { formato: option.formato, pagina: option.pagina }), label: option.label }
    : null;

  const web = view.screen === "web" ? await webPageHtml(service, record) : null;

  return (
    <div className="min-h-dvh bg-muted text-foreground">
      <PublicHeader brand={brand} download={download} />
      <main className={`flex flex-col items-center gap-4 px-4 py-6 sm:py-8 ${download ? "pb-24 sm:pb-8" : ""}`}>
        <div className="flex w-full flex-col items-center gap-4" style={{ maxWidth: view.maxWidth }}>
          {view.verification && <VerificationBox verification={view.verification} />}
          {view.screen === "pieces" && (
            <PieceImages code={pub.code} name={pub.name} version={pub.renderedVersion} format={pub.format} pageCount={pub.pageCount} voidStamp={view.voidStamp} />
          )}
          {view.screen === "web" && web && <WebFrame html={web.html} height={web.height} title={pub.name} />}
          {(view.screen === "preparing" || (view.screen === "web" && !web)) && <Preparing refresh={view.screen === "preparing"} />}
        </div>
      </main>
      {download && <MobileDownloadBar brand={brand} download={download} />}
    </div>
  );
}
