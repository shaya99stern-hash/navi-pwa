"use client";

import { useState } from "react";

export default function DeveloperSettings() {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [status, setStatus] = useState("");

  const handleDeploy = async () => {
    setStatus("Deploying...");
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content, commitMessage }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deployment failed");

      setStatus(`Success! Deployed to: ${data.commitUrl}`);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: "16px", maxWidth: "400px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: "bold" }}>PWA Self-Update Engine</h2>
      <input
        type="text"
        placeholder="File path (e.g., app/page.tsx)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        style={{ padding: "8px", border: "1px solid #ccc", borderRadius: "4px" }}
      />
      <textarea
        placeholder="Paste updated code content here..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        style={{ padding: "8px", border: "1px solid #ccc", borderRadius: "4px" }}
      />
      <input
        type="text"
        placeholder="Commit message"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        style={{ padding: "8px", border: "1px solid #ccc", borderRadius: "4px" }}
      />
      <button 
        onClick={handleDeploy} 
        style={{ padding: "10px", backgroundColor: "#000", color: "#fff", borderRadius: "4px", fontWeight: "bold", cursor: "pointer" }}
      >
        Push Update to GitHub & Vercel
      </button>
      {status && <p style={{ fontSize: "14px", marginTop: "8px" }}>{status}</p>}
    </div>
  );
}
