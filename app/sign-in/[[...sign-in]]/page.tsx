import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAppearance } from "@/app/components/auth-shell";
import { readAuthTheme } from "@/lib/ui/auth-theme";
import { describeClerkConfigGap, isClerkConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false }
};

export default async function SignInPage() {
  /* Rendered against the same cookie the layout uses to pick the status-bar
     style, so the glyphs and the background can never disagree. */
  const theme = await readAuthTheme();
  const configured = isClerkConfigured();
  // Promising Google while rendering no sign-in at all is how a configuration
  // gap reads as "the Google button disappeared".
  const gap = configured ? null : describeClerkConfigGap();
  if (gap) console.error(`Navi sign-in unavailable. ${gap}`);

  return (
    <AuthShell
      title="Welcome back"
      /* Which providers are on offer is a property of the Clerk instance, not
         of this page. Naming Google here made a dashboard that has no Google
         connection read as a missing button. */
      description={configured
        ? "Sign in to your private workspace."
        : "Sign-in is unavailable on this deployment."}
    >
      {configured ? (
        <SignIn
          path="/sign-in"
          routing="path"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/"
          forceRedirectUrl="/"
          oauthFlow="redirect"
          withSignUp
          appearance={clerkAppearance(theme)}
        />
      ) : (
        <p className="text-[0.875rem]/6 font-normal text-tertiary">
          This deployment is missing its authentication credentials, so no sign-in options can be shown. The deployment logs name what is absent.
        </p>
      )}
    </AuthShell>
  );
}
