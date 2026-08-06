"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
    <div className="p-4 space-y-4 max-w-md mx-auto">
      <h2 className="text-lg font-bold">PWA Self-Update Engine</h2>
      <Input
        placeholder="File path (e.g., app/page.tsx)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <Textarea
        placeholder="Paste updated code content here..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
      />
      <Input
        placeholder="Commit message"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <Button onClick={handleDeploy} className="w-full">
        Push Update to GitHub & Vercel
      </Button>
      {status && <p className="text-sm mt-2">{status}</p>}
    </div>
  );
}
