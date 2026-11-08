import type { Brand } from "@/lib/brand";
import { BRAND_TEXT_DARK, readableTextOn, safeBrandColor } from "@/lib/brand";
import { FORMATS } from "@/lib/designer/formats";
import { PREPARING_TEXT, PREPARING_TITLE, type VerificationBoxView } from "@/lib/designer/public/model";
import { WEB_IFRAME_SANDBOX } from "@/lib/designer/public/sandbox";
import { AutoRefresh } from "./auto-refresh";

/** Las partes de la página pública `/d/<código>` (F43). Sin menú, sin sesión y sin ningún pie de marca ajena. */

function brandColors(brand: Brand): { background: string; color: string } {
  const background = safeBrandColor(brand.colorHex) ?? BRAND_TEXT_DARK;
  return { background, color: readableTextOn(background) };
}

/** Cabecera: logo y nombre del negocio, y el botón Descargar (en escritorio; en celular va fijo abajo). */
export function PublicHeader({ brand, download }: { brand: Brand; download: { href: string; label: string } | null }) {
  const colors = brandColors(brand);
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-card px-4 text-card-foreground">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- el logo es del negocio y vive en un bucket público
        <img src={brand.logoUrl} alt="" className="h-7 w-auto max-w-[120px] rounded object-contain" />
      ) : (
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold" style={colors}>
          {brand.initial}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{brand.name}</span>
      {download && (
        <a href={download.href} rel="nofollow" className="hidden h-9 items-center rounded-lg px-4 text-sm font-medium sm:inline-flex" style={colors}>
          {download.label}
        </a>
      )}
    </header>
  );
}

/** Botón fijo abajo, solo en celular. */
export function MobileDownloadBar({ brand, download }: { brand: Brand; download: { href: string; label: string } }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-3 sm:hidden">
      <a href={download.href} rel="nofollow" className="flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium" style={brandColors(brand)}>
        {download.label}
      </a>
    </div>
  );
}

/** El recuadro de verificación de arriba: "✅ Certificado válido · emitido por … el … · Código …" o "⛔ … anulado · Motivo: …". */
export function VerificationBox({ verification }: { verification: VerificationBoxView }) {
  const valid = verification.status === "valid";
  // El ícono va aparte con su margen: pegado al texto, el espacio angosto lo dejaba encimado.
  const cut = verification.text.indexOf(" ");
  const icon = cut > 0 ? verification.text.slice(0, cut) : "";
  const rest = cut > 0 ? verification.text.slice(cut + 1) : verification.text;
  return (
    <div
      role="status"
      className={`w-full rounded-xl border bg-card px-4 py-3 text-sm text-card-foreground ${valid ? "border-emerald-500/40" : "border-red-500/50"}`}
    >
      <p className="font-semibold">
        {icon && (
          <span aria-hidden="true" className="mr-2">
            {icon}
          </span>
        )}
        {rest}
      </p>
    </div>
  );
}

/** Las páginas de una pieza como imágenes (la PNG renderizada), apiladas, con carga diferida y `srcset` ×1/×2. */
export function PieceImages({
  code,
  name,
  version,
  format,
  pageCount,
  voidStamp,
}: {
  code: string;
  name: string;
  version: string | null;
  format: keyof typeof FORMATS;
  pageCount: number;
  voidStamp: boolean;
}) {
  const def = FORMATS[format];
  const v = version ? `&v=${encodeURIComponent(version)}` : "";
  return (
    <>
      {Array.from({ length: pageCount }, (_, i) => {
        const base = `/d/${encodeURIComponent(code)}/p/${i + 1}`;
        return (
          <div key={i} className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- la imagen sale de una ruta propia que revisa el link */}
            <img
              src={`${base}?x=2${v}`}
              srcSet={`${base}?x=1${v} 1x, ${base}?x=2${v} 2x`}
              width={def.width}
              height={def.height}
              alt={pageCount > 1 ? `${name} · página ${i + 1} de ${pageCount}` : name}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="block h-auto w-full rounded-sm bg-white shadow-md"
            />
            {voidStamp && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="-rotate-[18deg] rounded-xl border-[6px] border-red-600/75 px-6 py-1 text-4xl font-extrabold text-red-600/75 sm:text-7xl">ANULADO</span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Una página web publicada: iframe `srcdoc` con `sandbox` SIN `allow-scripts`. */
export function WebFrame({ html, height, title }: { html: string; height: number; title: string }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox={WEB_IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      loading="lazy"
      className="h-[var(--web-h)] w-full border-0 bg-white shadow-md max-sm:h-[85dvh]"
      style={{ ["--web-h" as string]: `${height}px` }}
    />
  );
}

export function Preparing({ refresh }: { refresh: boolean }) {
  return (
    <div role="status" className="flex w-full flex-col items-center gap-2 rounded-xl border border-border bg-card px-6 py-16 text-center text-card-foreground">
      <p className="text-base font-semibold">{PREPARING_TITLE}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{PREPARING_TEXT}</p>
      {refresh && <AutoRefresh />}
    </div>
  );
}

export function TooManyRequests() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <p className="text-center text-sm text-muted-foreground">Demasiados pedidos. Probá de nuevo en un minuto.</p>
    </main>
  );
}
