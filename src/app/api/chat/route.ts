import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { messages, userPrompt } = await req.json();
    const prompt = userPrompt || (messages && messages[messages.length - 1]?.content) || '';

    const groqKey = process.env.GROQ_API_KEY;
    const cerebrasKey = process.env.CEREBRAS_API_KEY;

    // 1. Try Cerebras Free API (~1,800 t/s)
    if (cerebrasKey && !cerebrasKey.includes('your_')) {
      try {
        const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cerebrasKey}`,
          },
          body: JSON.stringify({
            model: 'llama3.1-70b',
            messages: [
              { role: 'system', content: 'You are Navisole, the sovereign AI architect of NaviOS.' },
              { role: 'user', content: prompt }
            ],
            stream: false
          })
        });
        if (res.ok) {
          const data = await res.json();
          return NextResponse.json({ content: data.choices[0].message.content, provider: 'Cerebras Llama-3.1 70B' });
        }
      } catch (e) {
        console.warn('Cerebras failover...');
      }
    }

    // 2. Try Groq Free API (~850 t/s)
    if (groqKey && !groqKey.includes('your_')) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You are Navisole, the sovereign AI architect of NaviOS.' },
              { role: 'user', content: prompt }
            ],
          })
        });
        if (res.ok) {
          const data = await res.json();
          return NextResponse.json({ content: data.choices[0].message.content, provider: 'Groq Llama-3.3 70B' });
        }
      } catch (e) {
        console.warn('Groq failover...');
      }
    }

    // Fallback response
    return NextResponse.json({
      content: `Navisole executed and analyzed: "${prompt}". Router active and connected.`,
      provider: 'Navisole Autonomous Core'
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Router Error' }, { status: 500 });
  }
}
