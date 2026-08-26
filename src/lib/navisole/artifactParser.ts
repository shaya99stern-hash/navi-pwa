export interface ParsedArtifact {
  id: string;
  type: string;
  title: string;
  language: string;
  content: string;
  cleanText: string;
}

export function extractArtifact(text: string): ParsedArtifact | null {
  if (!text) return null;

  // 1. XML <artifact> format
  const xmlMatch = text.match(/<artifact\s+identifier=["'](.*?)["']\s+type=["'](.*?)["']\s+title=["'](.*?)["']>([\s\S]*?)(?:<\/artifact>|$)/);
  if (xmlMatch) {
    const rawType = xmlMatch.toLowerCase();
    return {
      id: xmlMatch,
      type: rawType,
      title: xmlMatch[3],
      language: rawType === 'react' ? 'tsx' : (rawType === 'html' ? 'html' : 'typescript'),
      content: xmlMatch[4].trim(),
      cleanText: text.replace(/<artifact[\s\S]*?<\/artifact>/g, '').trim()
    };
  }

  // 2. Markdown Code Block Fallback
  const mdMatch = text.match(/```([a-zA-Z0-9_\-\+]*)\n([\s\S]*?)```/);
  if (mdMatch) {
    const lang = (mdMatch || 'typescript').toLowerCase();
    const code = mdMatch.trim();
    if (code.length > 25) {
      return {
        id: 'generated-artifact',
        type: 'code',
        title: `Interactive ${lang.toUpperCase()} Canvas`,
        language: lang,
        content: code,
        cleanText: text
      };
    }
  }

  return null;
}
