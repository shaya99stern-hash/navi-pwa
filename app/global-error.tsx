"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-US">
      <body style={{ margin: 0, background: "#100F0D", color: "#FAF6EF", fontFamily: "system-ui,-apple-system,sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "100%", maxWidth: 380, border: "1px solid #312C25", borderRadius: 28, background: "#181612", padding: 28, textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>NaviOS needs to restart</h1>
            <p style={{ margin: "14px 0 0", color: "#D9D0C5", lineHeight: 1.5 }}>Your local history is stored separately and should remain available.</p>
            <button type="button" onClick={reset} style={{ minHeight: 48, marginTop: 24, border: 0, borderRadius: 999, background: "#D77A59", color: "white", padding: "0 22px", fontWeight: 700 }}>Restart NaviOS</button>
          </section>
        </main>
      </body>
    </html>
  );
}
