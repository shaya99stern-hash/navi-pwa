"use client";

import { useState } from "react";

function ResearchToggleComponent() {
  const [isResearchMode, setIsResearchMode] = useState(false);

  return (
    <div style={{ padding: "16px", borderRadius: "8px", border: "1px solid #333", margin: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: "600" }}>Research Mode</span>
        <button
          onClick={() => setIsResearchMode(!isResearchMode)}
          style={{
            padding: "8px 16px",
            backgroundColor: isResearchMode ? "#10B981" : "#374151",
            color: "#fff",
            borderRadius: "6px",
            border: "none",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          {isResearchMode ? "Active" : "Off"}
        </button>
      </div>
      {isResearchMode && (
        <p style={{ fontSize: "14px", marginTop: "8px", color: "#9CA3AF" }}>
          Research tracking data streams and video analysis logs are now enabled.
        </p>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <main style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px" }}>Navi OS</h1>
      <ResearchToggleComponent />
    </main>
  );
}
