import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET(request: Request) {
  const logo = new URL("/pwa-icon-192-v4.png", request.url).toString();
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#100F0D" }}>
      {/* ImageResponse needs a native image element to preserve the supplied logo exactly. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" width="512" height="512" />
    </div>,
    { width: 512, height: 512, headers: { "Cache-Control": "public, max-age=86400, immutable" } }
  );
}
