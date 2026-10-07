import { ImageResponse } from "next/og";
import { brandColorHex, brandInitial } from "@/lib/brand";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Favicon generado: la inicial de la marca sobre su color. Un clon sin logo
 * propio no se queda sin favicon (antes era uno fijo en public/).
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: brandColorHex() ?? "#4f46e5",
          color: "#fff",
          fontSize: 20,
          fontWeight: 700,
          borderRadius: 6,
        }}
      >
        {brandInitial()}
      </div>
    ),
    { ...size }
  );
}
