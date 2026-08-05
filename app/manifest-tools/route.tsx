import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#C9785B", padding: 54, fontFamily: "Arial" }}>
      <div style={{ flex: 1, display: "flex", overflow: "hidden", borderRadius: 42, background: "#F4EEE6", boxShadow: "0 30px 90px rgba(52,31,21,.28)" }}>
        <div style={{ width: 360, display: "flex", flexDirection: "column", padding: 40, background: "#211914", color: "#FAF6EF" }}>
          <div style={{ fontSize: 38, fontWeight: 700 }}>NaviOS</div>
          <div style={{ marginTop: 18, fontSize: 18, lineHeight: 1.45, color: "#D9D0C5" }}>Private AI workspace</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 52 }}>
            {["New conversation", "Files and images", "Interactive tools", "Connections", "Settings"].map((item, index) => (
              <div key={item} style={{ padding: "18px 20px", borderRadius: 18, background: index === 0 ? "#3B2B24" : "transparent", fontSize: 20 }}>{item}</div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 56 }}>
          <div style={{ fontFamily: "Georgia", fontSize: 56, lineHeight: 1.05, color: "#211914" }}>Work across models, files, and tools.</div>
          <div style={{ marginTop: 22, maxWidth: 760, fontSize: 24, lineHeight: 1.45, color: "#5D5148" }}>NaviOS combines private reasoning with image generation, file analysis, and secure interactive artifacts.</div>
          <div style={{ display: "flex", gap: 22, marginTop: 48 }}>
            {/* Two modes, no model names and no provider names — an install
                screenshot is a user-visible surface like any other. */}
            {[
              ["Chat mode", "Everyday thinking, writing, and answers"],
              ["Code mode", "Repositories, builds, and deployments"],
              ["Private by default", "History stays on your device"]
            ].map(([title, detail]) => (
              <div key={title} style={{ flex: 1, minHeight: 190, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 28, borderRadius: 28, background: "#FFFDFC", border: "2px solid rgba(33,25,20,.08)" }}>
                <div style={{ fontSize: 25, fontWeight: 700, color: "#211914" }}>{title}</div>
                <div style={{ fontSize: 18, lineHeight: 1.4, color: "#80736A" }}>{detail}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "auto", minHeight: 92, display: "flex", alignItems: "center", padding: "18px 26px", borderRadius: 32, background: "#FFFDFC", border: "2px solid rgba(33,25,20,.14)", color: "#80736A", fontSize: 23 }}>Message NaviSoul</div>
        </div>
      </div>
    </div>,
    { width: 1600, height: 900, headers: { "Cache-Control": "public, max-age=86400" } }
  );
}
