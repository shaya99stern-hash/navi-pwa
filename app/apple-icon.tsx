import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#100F0D", borderRadius: 40, position: "relative" }}>
      <div style={{ width: 140, height: 140, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #3A332B", borderRadius: 38, background: "#181612" }}>
        <svg width="102" height="102" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="10" fill="#F8EFE6" />
          {Array.from({ length: 16 }, (_, index) => (
            <rect key={index} x="47" y="7" width="6" height="25" rx="3" fill="#F8EFE6" transform={`rotate(${index * 22.5} 50 50)`} />
          ))}
        </svg>
      </div>
      <div style={{ width: 16, height: 16, position: "absolute", right: 25, bottom: 23, borderRadius: 999, background: "#D77A59", border: "2px solid #100F0D" }} />
    </div>,
    size
  );
}
