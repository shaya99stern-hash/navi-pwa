import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0D12", color: "#F5F7FB", borderRadius: 40, fontFamily: "Arial", position: "relative" }}>
      <div style={{ width: 118, height: 118, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #262D3E", borderRadius: 32, background: "#11141C", fontSize: 86, fontWeight: 700, letterSpacing: -9, paddingRight: 7 }}>N</div>
      <div style={{ width: 12, height: 12, position: "absolute", right: 34, bottom: 33, borderRadius: 999, background: "#7A5CFF" }} />
    </div>,
    size
  );
}
