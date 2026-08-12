import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAppearance } from "@/app/components/auth-shell";
import { readAuthTheme } from "@/lib/ui/auth-theme";
import { describeClerkConfigGap, isClerkConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false }
};

export default async function SignUpPage() {
  const theme = await readAuthTheme();
  const configured = isClerkConfigured();
  const gap = configured ? null : describeClerkConfigGap();
  if (gap) console.error(`Navi sign-up unavailable. ${gap}`);

  return (
    <AuthShell
      title="Create your account"
      description={configured
        ? "Create your private workspace."
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
          appearance={clerkAppearance(theme)}
        />
      ) : (
        <p className="text-[0.875rem]/6 font-normal text-tertiary">
          This deployment is missing its authentication credentials, so no sign-up options can be shown. The deployment logs name what is absent.
        </p>
      )}
    </AuthShell>
  );
}
