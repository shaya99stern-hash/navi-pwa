import { AppShell } from "../components/app-shell";

type NewChatPageProps = {
  searchParams: Promise<{
    text?: string;
    title?: string;
    url?: string;
  }>;
};

export default async function NewChatPage({ searchParams }: NewChatPageProps) {
  const shared = await searchParams;
  const initialDraft = [shared.title, shared.text, shared.url]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12_000);

  return <AppShell initialDraft={initialDraft || undefined} />;
}
