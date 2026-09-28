import type { NextConfig } from "next";
import { nextHeadersConfig } from "./lib/security-headers";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
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
