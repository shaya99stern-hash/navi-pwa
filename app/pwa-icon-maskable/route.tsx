import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#100F0D" }}>
      <div style={{ width: 340, height: 340, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 112, background: "#181612", border: "8px solid #3A332B" }}>
        <svg width="230" height="230" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="10" fill="#F8EFE6" />
          {Array.from({ length: 16 }, (_, index) => (
            <rect key={index} x="47" y="7" width="6" height="25" rx="3" fill="#F8EFE6" transform={`rotate(${index * 22.5} 50 50)`} />
          ))}
        </svg>
      </div>
    </div>,
    { width: 512, height: 512, headers: { "Cache-Control": "public, max-age=86400, immutable" } }
  );
}
