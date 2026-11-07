/**
 * La imagen de la tarjeta que se ve al compartir un link: 1200 x 630, con la marca del negocio
 * que comparte. Solo de servidor. Logo y título van centrados porque WhatsApp a veces la recorta
 * a un cuadrado chico.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { BRAND_TEXT_DARK, mixHex, readableTextOn, safeBrandColor, type Brand } from "@/lib/brand";
import { loadLogo, type OgLogo } from "./logo";
import { titleFontSize } from "./text";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

type OgFonts = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];

let fontsPromise: Promise<OgFonts> | null = null;

/** Inter en negrita y regular. Si no se pueden leer, queda la letra que trae Next: la imagen sale igual. */
function loadFonts(): Promise<OgFonts> {
  fontsPromise ??= (async () => {
    try {
      const dir = join(process.cwd(), "lib", "og", "fonts");
      const [regular, bold] = await Promise.all([readFile(join(dir, "inter-latin-400-normal.woff")), readFile(join(dir, "inter-latin-700-normal.woff"))]);
      return [
        { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
        { name: "Inter", data: bold, weight: 700 as const, style: "normal" as const },
      ];
    } catch (error) {
      console.error("[vista previa] no pude leer la tipografía:", error instanceof Error ? error.message : String(error));
      return undefined;
    }
  })();
  return fontsPromise;
}

function Mark({ brand, logo, background, foreground }: { brand: Brand; logo: OgLogo | null; background: string; foreground: string }) {
  if (logo) {
    return (
      <div style={{ display: "flex", padding: 28, borderRadius: 28, background: logo.plate }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse dibuja con <img>, no con next/image */}
        <img src={logo.dataUrl} width={logo.width} height={logo.height} alt="" />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 150, height: 150, borderRadius: 28, background: foreground, color: background, fontSize: 84, fontWeight: 700 }}>
      {brand.initial}
    </div>
  );
}

export async function renderShareImage(input: { brand: Brand; title: string; subtitle: string }): Promise<Uint8Array> {
  const [logo, fonts] = await Promise.all([loadLogo(input.brand.logoUrl), loadFonts()]);
  const background = safeBrandColor(input.brand.colorHex) ?? BRAND_TEXT_DARK;
  const foreground = readableTextOn(background);

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 150px",
          textAlign: "center",
          color: foreground,
          // El degradé se aleja del color del texto: nunca le baja el contraste.
          background: `linear-gradient(145deg, ${background}, ${mixHex(background, foreground === "#ffffff" ? "#000000" : "#ffffff", 0.2)})`,
          fontFamily: fonts ? "Inter" : undefined,
        }}
      >
        <Mark brand={input.brand} logo={logo} background={background} foreground={foreground} />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 44, fontSize: titleFontSize(input.title), fontWeight: 700, lineHeight: 1.15, letterSpacing: -1 }}>{input.title}</div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24, fontSize: 34, opacity: 0.85 }}>{input.subtitle}</div>
      </div>
    ),
    { ...OG_IMAGE_SIZE, ...(fonts ? { fonts } : {}) },
  );

  // WhatsApp suele descartar las imágenes pesadas: con paleta queda muy por debajo de lo que acepta.
  const bytes = Buffer.from(await response.arrayBuffer());
  return new Uint8Array(await sharp(bytes).png({ palette: true, compressionLevel: 9 }).toBuffer());
}
