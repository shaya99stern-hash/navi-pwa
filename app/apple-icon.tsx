import { ImageResponse } from "next/og";

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
          background: "#0d0d0d",
          color: "#ffffff",
          borderRadius: "40px",
          fontFamily: "Arial, Helvetica, sans-serif",
          position: "relative"
        }}
      >
        <div
          style={{
            width: "118px",
            height: "118px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "3px solid #303030",
            borderRadius: "32px",
            background: "#171717",
            fontSize: "86px",
            fontWeight: 700,
            letterSpacing: "-9px",
            paddingRight: "7px"
          }}
        >
          N
        </div>
        <div
          style={{
            width: "12px",
            height: "12px",
            position: "absolute",
            right: "34px",
            bottom: "33px",
            borderRadius: "999px",
            background: "#ffffff"
          }}
        />
      </div>
    ),
    size
  );
}
