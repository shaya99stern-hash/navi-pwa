import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { path, content, commitMessage } = await req.json();

    if (!path || !content) {
      return NextResponse.json({ error: 'Missing path or content' }, { status: 400 });
    }

    if (typeof path !== 'string') {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const trimmedPath = path.trim();
    const pathSegments = trimmedPath.split('/');
    const hasInvalidPath =
      trimmedPath.length === 0 ||
      trimmedPath.startsWith('/') ||
      trimmedPath.includes('\\') ||
      trimmedPath.includes('..') ||
      pathSegments.some((segment) => segment.length === 0) ||
      pathSegments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment));

    if (hasInvalidPath) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const safePath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');

    const token = process.env.GITHUB_PAT;
    
    // Automatically uses your username and repo name
    const owner = process.env.GITHUB_OWNER || 'shaya99stern-hash'; 
    const repo = process.env.GITHUB_REPO || 'navi-pwa';

    if (!token) {
      return NextResponse.json({ error: 'Server misconfiguration: GITHUB_PAT missing' }, { status: 500 });
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${safePath}`;
    const encodedContent = Buffer.from(content).toString('base64');

    // 1. Check if the file exists to get its SHA
    let sha = null;
    const checkRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'NaviOS-App'
      }
    });

    if (checkRes.ok) {
      const fileData = await checkRes.json();
      sha = fileData.sha;
    }

    // 2. Commit the file
    const commitRes = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'User-Agent': 'NaviOS-App'
      },
      body: JSON.stringify({
        message: commitMessage || `Auto-commit ${path} via Navi OS`,
        content: encodedContent,
        sha: sha || undefined
      })
    });

    const result = await commitRes.json();

    if (!commitRes.ok) {
      return NextResponse.json({ error: result.message || 'GitHub commit failed' }, { status: commitRes.status });
    }

    return NextResponse.json({ success: true, url: result.commit.html_url });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
