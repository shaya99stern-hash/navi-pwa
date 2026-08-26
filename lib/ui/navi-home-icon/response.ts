import { createHash } from "node:crypto";
import chunk0 from "./chunk0";
import chunk1 from "./chunk1";
import chunk2 from "./chunk2";
import chunk3 from "./chunk3";
import chunk4 from "./chunk4";
import chunk5 from "./chunk5";

const EXPECTED_BYTES = 33_579;
const EXPECTED_SHA256 = "02782b8d245b4cb3a380beff746f9b19f907da4ddb837a03bbd56ab85fabbd63";
const iconBytes = Buffer.from([chunk0, chunk1, chunk2, chunk3, chunk4, chunk5].join(""), "base64");
const iconSha256 = createHash("sha256").update(iconBytes).digest("hex");

if (iconBytes.length !== EXPECTED_BYTES || iconSha256 !== EXPECTED_SHA256) {
  throw new Error("NaviOS home icon data integrity check failed.");
}

export function naviHomeIconResponse(): Response {
  return new Response(new Uint8Array(iconBytes), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(iconBytes.length),
      "Cache-Control": "public, max-age=0, must-revalidate",
      ETag: `\"${EXPECTED_SHA256}\"`
    }
  });
}
