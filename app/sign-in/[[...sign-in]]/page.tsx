import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAuthAppearance } from "@/app/components/auth-shell";
import { describeClerkConfigGap, isClerkConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false }
};

export default function SignInPage() {
  const configured = isClerkConfigured();
  // Promising Google while rendering no sign-in at all is how a configuration
  // gap reads as "the Google button disappeared".
  const gap = configured ? null : describeClerkConfigGap();
  if (gap) console.error(`Navi sign-in unavailable. ${gap}`);

  return (
    <AuthShell
      title="Welcome back"
      description={configured
        ? "Continue with Google or use a secure email sign-in."
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
          appearance={clerkAuthAppearance}
        />
      ) : (
        <p className="text-center text-sm leading-6 text-[#bdb2a7]">
          This deployment is missing its authentication credentials, so no sign-in options can be shown. The deployment logs name what is absent.
        </p>
      )}
    </AuthShell>
  );
}
