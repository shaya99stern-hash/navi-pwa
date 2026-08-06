import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { path, content, commitMessage } = await req.json();

    if (!path || !content) {
      return NextResponse.json({ error: 'Missing path or content' }, { status: 400 });
    }

    const token = process.env.GITHUB_PAT;
    const owner = 'YOUR_GITHUB_USERNAME'; // <--- Replace with your GitHub username
    const repo = 'YOUR_REPO_NAME';       // <--- Replace with your repo name

    if (!token) {
      return NextResponse.json({ error: 'Server misconfiguration: GITHUB_PAT missing' }, { status: 500 });
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
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
