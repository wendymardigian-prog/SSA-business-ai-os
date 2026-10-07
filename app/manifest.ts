import type { MetadataRoute } from "next";
import { brandName, brandColorHex } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  const name = brandName();
  return {
    name,
    short_name: name,
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    theme_color: brandColorHex() ?? "#6366f1",
    background_color: "#ffffff",
    display: "standalone",
  };
}
