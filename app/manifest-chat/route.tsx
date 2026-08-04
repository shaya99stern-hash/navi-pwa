import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#C9785B", padding: "110px 84px", fontFamily: "Arial" }}>
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 72, background: "#F4EEE6", boxShadow: "0 40px 100px rgba(52,31,21,.28)" }}>
        <div style={{ height: 150, display: "flex", alignItems: "center", padding: "0 54px", borderBottom: "2px solid rgba(33,25,20,.08)", fontSize: 42, fontWeight: 700, color: "#211914" }}>NaviOS</div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "70px 70px 130px" }}>
          <div style={{ width: 150, height: 150, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 50, background: "#FFFDFC", border: "2px solid rgba(33,25,20,.08)" }}>
            <svg width="98" height="98" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="10" fill="#C96F50" />
              {Array.from({ length: 16 }, (_, index) => (
                <rect key={index} x="47" y="7" width="6" height="25" rx="3" fill="#C96F50" transform={`rotate(${index * 22.5} 50 50)`} />
              ))}
            </svg>
          </div>
          <div style={{ marginTop: 42, fontFamily: "Georgia", fontSize: 72, lineHeight: 1.06, color: "#211914", textAlign: "center" }}>How can I help you today?</div>
          <div style={{ marginTop: 24, maxWidth: 760, fontSize: 31, lineHeight: 1.45, color: "#5D5148", textAlign: "center" }}>A private AI workspace for conversations, files, images, and tools.</div>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 22, marginTop: 68 }}>
            {[
              ["Plan something complex", "Turn a project into clear steps and deliverables."],
              ["Create a polished image", "Generate a real raster image."],
              ["Build an interactive tool", "Create working controls and local logic."]
            ].map(([title, detail]) => (
              <div key={title} style={{ display: "flex", flexDirection: "column", padding: "30px 34px", borderRadius: 34, background: "#FFFDFC", border: "2px solid rgba(33,25,20,.08)" }}>
                <div style={{ fontSize: 31, fontWeight: 700, color: "#211914" }}>{title}</div>
                <div style={{ marginTop: 8, fontSize: 24, color: "#80736A" }}>{detail}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: "28px 38px 46px", background: "linear-gradient(to top,#F4EEE6 75%,rgba(244,238,230,0))" }}>
          <div style={{ minHeight: 120, display: "flex", alignItems: "center", padding: "20px 28px", borderRadius: 42, background: "#FFFDFC", border: "2px solid rgba(33,25,20,.14)", color: "#80736A", fontSize: 30 }}>Message Navi</div>
        </div>
      </div>
    </div>,
    { width: 1179, height: 2556, headers: { "Cache-Control": "public, max-age=86400" } }
  );
}
