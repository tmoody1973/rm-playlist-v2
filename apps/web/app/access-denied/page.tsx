import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";

/**
 * Friendly bounce page for users who authenticated successfully but
 * whose email domain isn't on the dashboard allowlist
 * (apps/web/app/dashboard/layout.tsx).
 *
 * Two reasons someone lands here:
 *   1. Curious visitor signed up to see the dashboard with a non-RM email
 *      (Gmail, etc). Tells them politely to email digital@radiomilwaukee.org
 *      if they should have access.
 *   2. RM staff member's primary email isn't @radiomilwaukee.org
 *      (oversight in their Clerk profile). Same path — operator emails us
 *      and we can either help them update their Clerk email or add their
 *      personal domain to the allowlist.
 *
 * Clean sign-out button so the user can leave without a session lingering.
 */
export default async function AccessDeniedPage() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <main
      data-theme="light"
      className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      <div className="flex max-w-xl flex-col gap-5 text-center">
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          PlaylistFM · Powered by Radio Milwaukee
        </span>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(32px, 6vw, 48px)",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
          }}
        >
          This dashboard is for Radio Milwaukee staff.
        </h1>
        <p
          style={{
            fontSize: "16px",
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          The operator dashboard is restricted to staff with a{" "}
          <code
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--bg-elevated)",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "14px",
            }}
          >
            @radiomilwaukee.org
          </code>{" "}
          email address. If you should have access — or you signed up with the wrong email — drop us
          a line at{" "}
          <a
            href="mailto:digital@radiomilwaukee.org"
            style={{
              color: "var(--accent-cta)",
              textDecoration: "underline",
              textDecorationColor: "var(--accent-cta)",
              textUnderlineOffset: "3px",
            }}
          >
            digital@radiomilwaukee.org
          </a>{" "}
          and we&apos;ll get you sorted.
        </p>
        {email !== null && (
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            You&apos;re currently signed in as{" "}
            <span style={{ color: "var(--text-primary)" }}>{email}</span>.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-md px-4 py-2 text-sm font-semibold uppercase"
          style={{
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            letterSpacing: "0.04em",
            fontFamily: "var(--font-mono)",
          }}
        >
          Back to homepage
        </Link>
        <SignOutButton redirectUrl="/">
          <button
            type="button"
            className="rounded-md px-4 py-2 text-sm font-semibold uppercase"
            style={{
              background: "var(--accent-cta)",
              color: "var(--bg-base)",
              letterSpacing: "0.04em",
              fontFamily: "var(--font-mono)",
            }}
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
