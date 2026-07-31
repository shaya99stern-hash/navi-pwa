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
  /* Colour, radius and width only.
     Deliberately no font sizes: Tailwind's are rem-based, so a device using a
     larger iOS text size scaled Clerk's labels past the boxes Clerk had
     already measured for its own scale, and "Email address" lost its first
     letter to the overflow. Clerk sizes its own type from the variables above,
     which is the one scale its layout is built against. */
  elements: {
    rootBox: "w-full",
    cardBox: "w-full max-w-none border-0 bg-transparent shadow-none",
    card: "w-full max-w-none overflow-visible border-0 bg-transparent p-0 shadow-none",
    header: "hidden",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    main: "w-full",
    form: "w-full",
    socialButtons: "w-full",
    socialButtonsBlockButton:
      "min-h-[52px] w-full rounded-2xl border border-white/15 bg-white/5 text-white shadow-none hover:bg-white/10",
    socialButtonsBlockButtonText: "font-medium text-white",
    dividerLine: "bg-white/10",
    dividerText: "text-[#938a81]",
    formField: "w-full min-w-0",
    formFieldRow: "w-full min-w-0",
    formFieldLabelRow: "w-full min-w-0 overflow-visible",
    formFieldLabel: "block overflow-visible font-medium text-[#d8cec3]",
    formFieldInput: "min-h-[52px] w-full rounded-2xl border border-white/15 bg-white/5 text-white shadow-none",
    formButtonPrimary:
      "min-h-[52px] w-full rounded-2xl bg-[#c76740] font-semibold normal-case tracking-normal text-white shadow-none hover:bg-[#b65734]",
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
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[#d67249]">NaviOS Hub</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h1>
          <p className="mx-auto mt-3 max-w-[340px] text-sm leading-6 text-[#bdb2a7]">{description}</p>
        </header>
        {/* overflow-visible so a label or focus ring can never be clipped by
            the frame, and the padding stays modest so the embedded widget
            keeps its full measure on a 390pt screen. */}
        <div className="overflow-visible rounded-[24px] border border-white/10 bg-white/[0.035] p-4 sm:p-6">{children}</div>
        <p className="mt-5 text-center text-xs leading-5 text-[#938a81]">NaviOS Hub is a private, local-first workspace.</p>
      </section>
    </main>
  );
}
