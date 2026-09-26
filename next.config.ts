import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async redirects() {
    return [
      // Analytics se renombró a Dashboards (F13). El link viejo redirige permanente.
      { source: "/dashboard/analytics", destination: "/dashboard/dashboards/chat", permanent: true },
    ];
  },
};

export default nextConfig;
