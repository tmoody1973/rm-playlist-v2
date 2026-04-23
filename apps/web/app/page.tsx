import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";

/**
 * Public landing. Authenticated users see a "Go to dashboard" link;
 * anonymous users see "Sign in". Milestone 3 surface — will evolve.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">rm-playlist-v2</h1>
        <p className="max-w-md text-base text-[#8B9099]">
          Radio Milwaukee playlist platform — operator dashboard and embeddable widgets.
        </p>
      </div>
      <div className="flex gap-3">
        <SignedOut>
          <Link
            href="/sign-in"
            className="rounded-md bg-[#E84F2F] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#CC3F22]"
          >
            Sign in
          </Link>
        </SignedOut>
        <SignedIn>
          <Link
            href="/dashboard"
            className="rounded-md bg-[#E84F2F] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#CC3F22]"
          >
            Go to dashboard
          </Link>
        </SignedIn>
      </div>
    </main>
  );
}
