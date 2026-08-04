import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", background: "#C9785B", padding: 54, fontFamily: "Arial" }}>
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 64, borderRadius: 42, background: "#F4EEE6", padding: "70px 82px", boxShadow: "0 34px 90px rgba(52,31,21,.28)" }}>
        <div style={{ width: 230, height: 230, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 72, background: "#100F0D" }}>
          <svg width="150" height="150" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="10" fill="#F8EFE6" />
            {Array.from({ length: 16 }, (_, index) => (
              <rect key={index} x="47" y="7" width="6" height="25" rx="3" fill="#F8EFE6" transform={`rotate(${index * 22.5} 50 50)`} />
            ))}
          </svg>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 5, textTransform: "uppercase", color: "#C96F50" }}>NaviOS</div>
          <div style={{ marginTop: 24, fontFamily: "Georgia", fontSize: 70, lineHeight: 1.02, color: "#211914" }}>Your private AI workspace.</div>
          <div style={{ marginTop: 24, fontSize: 28, lineHeight: 1.45, color: "#5D5148" }}>Conversations, files, images, tools, and multi-provider reasoning in one installable app.</div>
        </div>
      </div>
    </div>,
    size
  );
}
