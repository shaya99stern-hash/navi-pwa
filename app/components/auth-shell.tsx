import { NaviMark } from "./navi-mark";

export const clerkAuthAppearance = {
  variables: {
    colorPrimary: "#b85c38",
    colorBackground: "#191614",
    colorText: "#f7f0e8",
    colorTextSecondary: "#bdb2a7",
    colorInputBackground: "#241f1b",
    colorInputText: "#f7f0e8",
    borderRadius: "16px",
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full border-0 bg-transparent shadow-none",
    card: "w-full border-0 bg-transparent p-0 shadow-none",
    header: "hidden",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    socialButtonsBlockButton: "h-[52px] rounded-2xl border border-white/15 bg-white/5 text-white shadow-none hover:bg-white/10",
    formFieldLabel: "text-sm font-medium text-[#d8cec3]",
    formFieldInput: "h-[52px] rounded-2xl border border-white/15 bg-white/5 text-base text-white shadow-none",
    formButtonPrimary: "h-[52px] rounded-2xl bg-[#c76740] text-sm font-semibold text-white shadow-none hover:bg-[#b65734]",
    footer: "bg-transparent",
    footerActionText: "text-[#bdb2a7]",
    footerActionLink: "font-semibold text-[#e48a62]"
  }
};

export function AuthShell({
  title,
  description,
  children
}: Readonly<{ title: string; description: string; children: React.ReactNode }>) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#191614] px-4 py-8 text-[#f7f0e8]">
      <section className="w-full max-w-[430px]">
        <header className="mb-8 text-center">
          <NaviMark className="mx-auto mb-5 h-12 w-12 text-[#d67249]" label="NaviOS Hub" />
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d67249]">NaviOS Hub</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h1>
          <p className="mx-auto mt-3 max-w-[340px] text-sm leading-6 text-[#bdb2a7]">{description}</p>
        </header>
        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-5 sm:p-6">{children}</div>
        <p className="mt-5 text-center text-xs leading-5 text-[#938a81]">NaviOS Hub is a private, local-first workspace.</p>
      </section>
    </main>
  );
}
