import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAuthAppearance } from "@/app/components/auth-shell";
import { isClerkConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false }
};

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" description="Start with Google or a secure email sign-up.">
      {isClerkConfigured() ? (
        <SignUp
          path="/sign-up"
          routing="path"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/"
          forceRedirectUrl="/"
          oauthFlow="redirect"
          appearance={clerkAuthAppearance}
        />
      ) : (
        <p className="text-center text-sm leading-6 text-[#bdb2a7]">Sign-up is not configured for this deployment.</p>
      )}
    </AuthShell>
  );
}
