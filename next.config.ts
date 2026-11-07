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
  // Etapa 4 (§15): las paginas publicas de reserva y el embed se pueden
  // embeber; el resto de la app, no. La regla vive en lib/security-headers.ts.
  async headers() {
    return nextHeadersConfig();
  },
  async redirects() {
    return [
      // Analytics se renombró a Dashboards (F13). El link viejo redirige permanente.
      { source: "/dashboard/analytics", destination: "/dashboard/dashboards/chat", permanent: true },
    ];
  },
};

export default nextConfig;
