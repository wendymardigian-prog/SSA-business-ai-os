import type { NextConfig } from "next";
import { nextHeadersConfig } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Las etiquetas de la tarjeta de un link van siempre en el <head>, para cualquier lector:
  // no se sabe con qué identificador pregunta cada uno (Evolution, WhatsApp Web), y sin esto
  // Next las manda al final a quien no está en su lista. Solo cambia algo en las páginas con
  // `generateMetadata`; el Suspense del panel no depende de esta opción.
  htmlLimitedBots: /.*/,
  // Sin optimizador de imágenes: `/_next/image` con `remotePatterns` abierto ("**") era un proxy
  // público y sin sesión que bajaba cualquier imagen de internet desde nuestro servidor (y el
  // optimizador tuvo avisos críticos de RCE y SSRF). Con `unoptimized`, `next/image` pinta un <img>
  // directo y el servidor nunca baja una imagen ajena. Si algún día hace falta optimizar, que sea
  // con una lista cerrada de dominios, nunca con "**".
  images: {
    unoptimized: true,
  },
  experimental: {
    // @plantilla-desde(disenador)
    // Diseñador IA: cargar un .zip de hasta 50 MB (F39) y subir imágenes de hasta 20 MB (F22) son Server Actions, y sin
    // esto rige el tope de 1 MB. 51 MB deja margen para el armado del multipart. Cada acción vuelve a validar el tamaño
    // y los bytes del archivo ANTES de usarlo (`MAX_ZIP_BYTES`, `checkImageUpload`); el tope de acá solo deja llegar.
    serverActions: {
      bodySizeLimit: "51mb",
    },
    // @plantilla-hasta(disenador)
    // Volver a una pantalla abierta hace menos de 30 s la muestra al instante, desde la memoria del navegador, en vez
    // de pedirla de nuevo al servidor (Next 16 vuelve a pedir siempre). Lo que edita la persona se ve igual: las
    // acciones hacen `router.refresh()` o `revalidatePath`, que borran esa memoria. Un cambio de OTRA persona se puede
    // ver hasta 30 s tarde al volver a la pantalla; recargar lo trae enseguida. La bandeja recibe los mensajes en vivo.
    staleTimes: {
      dynamic: 30,
    },
  },
  // Etapa 4 (§15): las paginas publicas de reserva y el embed se pueden
  // embeber; el resto de la app, no. La regla vive en lib/security-headers.ts.
  async headers() {
    return nextHeadersConfig();
  },
  async redirects() {
    return [
      // Analytics se renombró a Dashboards (F13). El link viejo redirige permanente.
      { source: "/dashboard/analytics", destination: "/dashboard/dashboards", permanent: true },
    ];
  },
};

export default nextConfig;
