import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

function Mark() {
  return (
    <svg width="286" height="286" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="10" fill="#F8EFE6" />
      {Array.from({ length: 16 }, (_, index) => (
        <rect key={index} x="47" y="7" width="6" height="25" rx="3" fill="#F8EFE6" transform={`rotate(${index * 22.5} 50 50)`} />
      ))}
    </svg>
  );
}

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#100F0D", borderRadius: 112, position: "relative" }}>
      <div style={{ width: 390, height: 390, display: "flex", alignItems: "center", justifyContent: "center", border: "8px solid #3A332B", borderRadius: 112, background: "radial-gradient(circle at 50% 42%, #4A281E 0%, #181612 65%)" }}>
        <Mark />
      </div>
      <div style={{ width: 42, height: 42, position: "absolute", right: 84, bottom: 80, borderRadius: 999, background: "#D77A59", border: "6px solid #100F0D" }} />
    </div>,
    size
  );
}
