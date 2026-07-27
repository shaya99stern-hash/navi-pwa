import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: "112px",
          fontFamily: "Arial, Helvetica, sans-serif",
          position: "relative"
        }}
      >
        <div
          style={{
            width: "332px",
            height: "332px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "8px solid #303030",
            borderRadius: "94px",
            background: "#171717",
            fontSize: "246px",
            fontWeight: 700,
            letterSpacing: "-24px",
            paddingRight: "22px"
          }}
        >
          N
        </div>
        <div
          style={{
            width: "34px",
            height: "34px",
            position: "absolute",
            right: "102px",
            bottom: "98px",
            borderRadius: "999px",
            background: "#ffffff"
          }}
        />
      </div>
    ),
    size
  );
}
