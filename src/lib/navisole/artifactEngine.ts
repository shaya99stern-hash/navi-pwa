export interface LiveArtifact {
  id: string;
  title: string;
  type: 'html' | 'react' | 'code' | 'svg';
  language: string;
  content: string;
}

export function detectOrGenerateArtifact(prompt: string, aiResponse: string): LiveArtifact | null {
  const xmlMatch = aiResponse.match(/<artifact\s+identifier=["'](.*?)["']\s+type=["'](.*?)["']\s+title=["'](.*?)["']>([\s\S]*?)(?:<\/artifact>|$)/);
  if (xmlMatch) {
    return {
      id: xmlMatch,
      type: (xmlMatch as any) || 'html',
      title: xmlMatch,
      language: xmlMatch === 'react' ? 'tsx' : 'html',
      content: xmlMatch.trim()
    };
  }

  const mdMatch = aiResponse.match(/```([a-zA-Z0-9_\-\+]*)\n([\s\S]*?)```/);
  if (mdMatch) {
    const lang = (mdMatch || 'html').toLowerCase();
    return {
      id: 'generated-artifact',
      type: lang === 'html' ? 'html' : 'code',
      title: `${lang.toUpperCase()} Interactive Artifact`,
      language: lang,
      content: mdMatch.trim()
    };
  }

  const p = prompt.toLowerCase();
  if (p.includes('moving car') || p.includes('car')) {
    return {
      id: 'moving-car',
      title: 'Interactive Moving Car Simulation',
      type: 'html',
      language: 'html',
      content: `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; background: #0b0f19; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; overflow: hidden; }
  .road { width: 100%; height: 120px; background: #1e293b; position: relative; border-top: 4px solid #f97316; border-bottom: 4px solid #f97316; }
  .lane-line { position: absolute; top: 56px; width: 100%; height: 8px; background: repeating-linear-gradient(90deg, #f59e0b 0, #f59e0b 40px, transparent 40px, transparent 80px); animation: moveRoad 0.6s linear infinite; }
  .car { position: absolute; bottom: 25px; left: 100px; font-size: 50px; transition: transform 0.2s; }
  @keyframes moveRoad { from { background-position: 0 0; } to { background-position: -80px 0; } }
  .controls { margin-top: 24px; display: flex; gap: 12px; }
  button { padding: 10px 20px; background: #f97316; border: none; border-radius: 8px; color: #fff; font-weight: bold; cursor: pointer; }
  button:hover { background: #ea580c; }
</style>
</head>
<body>
  <h2>🏎️ NaviOS Live Interactive Canvas</h2>
  <div class="road">
    <div class="lane-line" id="lane"></div>
    <div class="car" id="car">🏎️</div>
  </div>
  <div class="controls">
    <button onclick="speedUp()">⚡ Boost Speed</button>
    <button onclick="slowDown()">🛑 Slow Down</button>
    <button onclick="honk()">🔊 Honk</button>
  </div>
  <script>
    let speed = 0.6;
    function speedUp() { speed = Math.max(0.1, speed - 0.15); document.getElementById('lane').style.animationDuration = speed + 's'; }
    function slowDown() { speed += 0.2; document.getElementById('lane').style.animationDuration = speed + 's'; }
    function honk() { const c = document.getElementById('car'); c.style.transform = 'translateY(-15px) scale(1.1)'; setTimeout(() => c.style.transform = 'translateY(0)', 200); }
  </script>
</body>
</html>`
    };
  }

  return null;
}
