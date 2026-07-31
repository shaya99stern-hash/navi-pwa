import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAuthAppearance } from "@/app/components/auth-shell";
import { describeClerkConfigGap, isClerkConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false }
};

export default function SignUpPage() {
  const configured = isClerkConfigured();
  const gap = configured ? null : describeClerkConfigGap();
  if (gap) console.error(`Navi sign-up unavailable. ${gap}`);

  return (
    <AuthShell
      title="Create your account"
      description={configured
        ? "Start with Google or a secure email sign-up."
        : "Sign-up is unavailable on this deployment."}
    >
      {configured ? (
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
        <p className="text-center text-sm leading-6 text-[#bdb2a7]">
          This deployment is missing its authentication credentials, so no sign-up options can be shown. The deployment logs name what is absent.
        </p>
      )}
    </AuthShell>
  );
}
