import { ImageResponse } from "next/og";
import { brandColorHex, brandInitial } from "@/lib/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 96,
          fontWeight: 700,
        }}
      >
        {brandInitial()}
      </div>
    ),
    { ...size }
  );
}
