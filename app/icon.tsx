import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0D12", color: "#F5F7FB", borderRadius: 112, fontFamily: "Arial", position: "relative" }}>
      <div style={{ width: 332, height: 332, display: "flex", alignItems: "center", justifyContent: "center", border: "8px solid #262D3E", borderRadius: 94, background: "#11141C", fontSize: 246, fontWeight: 700, letterSpacing: -24, paddingRight: 22 }}>N</div>
      <div style={{ width: 34, height: 34, position: "absolute", right: 102, bottom: 98, borderRadius: 999, background: "#7A5CFF" }} />
    </div>,
    size
  );
}
