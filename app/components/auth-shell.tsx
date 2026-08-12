import { NaviMark } from "./navi-mark";

/**
 * The first screen anyone sees, in the same app as the rest of it.
 *
 * This file used to hardcode #191614, #c76740, #b85c38, #f7f0e8 and a 16px
 * radius — none of which exist anywhere else in the product. The app's ground
 * is #262624 and its accent #D97757, so sign-in was the one screen that was
 * off-brand, and it was dark-only regardless of the theme the user had chosen.
 *
 * That second part was not only a colour problem. `statusBarStyle` is chosen
 * from the theme cookie: a light-theme user gets `default`, which draws dark
 * glyphs. Painting a near-black background under dark glyphs removed the
 * clock, battery and signal entirely. Rendering in the user's actual theme is
 * what fixes both.
 *
 * Clerk computes its own hover and focus shades from these values, so they
 * have to be literal colours rather than `var(--…)` references — a `var()`
 * would survive as a background and then break every derived shade. The two
 * tables below are the same tokens as `globals.css`, kept literal for that
 * one reason.
 */
const PALETTE = {
  dark: {
    background: "#262624",
    surface: "#2B2A28",
    input: "#30302E",
    text: "#F5F4EF",
    textSecondary: "#C2C0B7",
    textTertiary: "#9B9A91",
    border: "rgba(255,255,255,0.16)",
    accent: "#D97757",
    accentPressed: "#C15F3C"
  },
  light: {
    background: "#FAF9F5",
    surface: "#F5F4EE",
    input: "#FFFFFF",
    text: "#1F1E1D",
    textSecondary: "#52504A",
    textTertiary: "#83827B",
    border: "rgba(31,30,29,0.18)",
    accent: "#C15F3C",
    accentPressed: "#A84E2F"
  }
} as const;

export function clerkAppearance(theme: "dark" | "light" = "dark") {
  const c = PALETTE[theme];
  return {
    variables: {
      colorPrimary: c.accent,
      colorBackground: c.background,
      colorText: c.text,
      colorTextSecondary: c.textSecondary,
      colorInputBackground: c.input,
      colorInputText: c.text,
      borderRadius: "16px",
      fontFamily: "ui-sans-serif, system-ui, sans-serif"
    },
    /* Colour, radius and width only.
       Deliberately no font sizes: Tailwind's are rem-based, so a device using a
       larger iOS text size scaled Clerk's labels past the boxes Clerk had
       already measured for its own scale, and "Email address" lost its first
       letter to the overflow. Clerk sizes its own type from the variables
       above, which is the one scale its layout is built against. */
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
        "min-h-[52px] w-full rounded-2xl border border-[var(--border-strong)] bg-card text-primary shadow-none active:bg-elev-2",
      socialButtonsBlockButtonText: "font-semibold text-primary",
      dividerLine: "bg-[var(--border-subtle)]",
      dividerText: "text-tertiary",
      formField: "w-full min-w-0",
      formFieldRow: "w-full min-w-0",
      formFieldLabelRow: "w-full min-w-0 overflow-visible",
      formFieldLabel: "block overflow-visible font-semibold text-secondary",
      formFieldInput: "min-h-[52px] w-full rounded-2xl border border-[var(--border-strong)] bg-card text-primary shadow-none",
      formButtonPrimary:
        "min-h-[52px] w-full rounded-2xl bg-accent font-semibold normal-case tracking-normal text-[var(--accent-on-primary)] shadow-none active:bg-accent-pressed",
      footer: "bg-transparent",
      footerActionText: "text-tertiary",
      footerActionLink: "font-semibold text-accent"
    }
  };
}

export function AuthShell({
  title,
  description,
  children
}: Readonly<{ title: string; description: string; children: React.ReactNode }>) {
  return (
    /* `.navi-page` rather than `py-8`: the shell owns the safe areas for every
       screen inside it, and these full-bleed pages sit outside the shell. With
       `black-translucent` the status bar overlays content, so 32px of padding
       against a 59px inset put the wordmark under the Dynamic Island. */
    <main className="navi-page flex flex-col justify-center">
      <section className="mx-auto w-full max-w-[360px]">
        <NaviMark className="h-11 w-11 text-accent" label="NaviOS" />
        <p className="mt-5 text-[0.6875rem]/[0.6875rem] font-semibold uppercase tracking-[0.16em] text-accent">NaviOS</p>
        <h1 className="hero-title mt-3 text-[2rem]/[2.375rem] font-normal tracking-[-0.025em]">{title}</h1>
        <p className="mt-3 max-w-[30ch] text-[0.875rem]/[1.3125rem] font-normal text-secondary">{description}</p>
        {/* overflow-visible so a label or focus ring can never be clipped, and
            no card frame around it: the widget is the content of this screen,
            not a panel sitting on it. */}
        <div className="mt-7 overflow-visible">{children}</div>
        <p className="mt-6 text-[0.75rem]/5 font-normal text-tertiary">NaviOS is a private, local-first workspace.</p>
      </section>
    </main>
  );
}
