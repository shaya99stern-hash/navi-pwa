import { SignOutButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/app/components/auth-shell";
import { isClerkConfigured } from "@/lib/auth/config";

export const metadata: Metadata = {
  title: "Access restricted",
  robots: { index: false, follow: false }
};

export default function AccessDeniedPage() {
  return (
    <AuthShell
      title="This NaviOS is private"
      description="You signed in successfully, but this Google account is not on the workspace owner list."
    >
      {isClerkConfigured() ? (
        <SignOutButton redirectUrl="/sign-in">
          <button
            type="button"
            className="h-[52px] w-full rounded-2xl bg-[#c76740] text-sm font-semibold text-white hover:bg-[#b65734]"
          >
            Use a different account
          </button>
        </SignOutButton>
      ) : (
        <Link
          href="/"
          className="flex h-[52px] w-full items-center justify-center rounded-2xl bg-[#c76740] text-sm font-semibold text-white hover:bg-[#b65734]"
        >
          Return to NaviOS
        </Link>
      )}
    </AuthShell>
  );
}
