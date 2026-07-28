import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAuthAppearance } from "@/app/components/auth-shell";
import { isClerkConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false }
};

export default function SignInPage() {
  return (
    <AuthShell title="Welcome back" description="Continue with Google or use a secure email sign-in.">
      {isClerkConfigured() ? (
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
        <p className="text-center text-sm leading-6 text-[#bdb2a7]">Sign-in is not configured for this deployment.</p>
      )}
    </AuthShell>
  );
}
