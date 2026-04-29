import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { RoleBadge } from "./RoleBadge";

/**
 * Dashboard chrome per docs/design/001-IA.md section A.
 *   ├─ Top bar (48px): RM wordmark + role/session indicator
 *   └─ Left sidebar (~56px, icon-only): Dashboard / Streams / Reports /
 *      Events / Unclassified / Widgets / Settings
 *
 * Server component; embeds the role-badge client component for live role.
 */
export async function Shell({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const displayName = user?.firstName ?? user?.username ?? "Operator";

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar displayName={displayName} />
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

function TopBar({ displayName }: { displayName: string }) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-bg-surface px-6">
      <div className="flex items-center gap-3">
        <span
          style={{ fontFamily: "var(--font-display)" }}
          className="text-sm font-semibold tracking-tight"
        >
          Radio Milwaukee
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-text-muted">{displayName}</span>
        <RoleBadge />
        <UserButton afterSignOutUrl="/" />
      </div>
    </header>
  );
}

const NAV_ITEMS: Array<{ href: string; label: string; icon: ReactNode }> = [
  { href: "/dashboard", label: "Dashboard", icon: <HomeIcon /> },
  { href: "/dashboard/streams", label: "Streams", icon: <StreamsIcon /> },
  { href: "/dashboard/reports", label: "Reports", icon: <ReportsIcon /> },
  { href: "/dashboard/events", label: "Events", icon: <EventsIcon /> },
  { href: "/dashboard/widgets", label: "Widgets", icon: <WidgetsIcon /> },
  { href: "/dashboard/settings", label: "Settings", icon: <SettingsIcon /> },
];

function Sidebar() {
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-surface py-3">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          className="group flex h-10 w-10 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--dur-micro)] hover:bg-bg-elevated hover:text-accent-cta"
        >
          {item.icon}
          <span className="sr-only">{item.label}</span>
        </Link>
      ))}
    </aside>
  );
}

// --- Icons (Lucide-style minimal SVGs). Kept inline to keep the Milestone 5
// bundle tiny; can swap for `lucide-react` in Milestone 6 if we want more. ---

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      {children}
    </svg>
  );
}
function HomeIcon() {
  return (
    <Icon>
      <path d="M3 12 12 4l9 8" />
      <path d="M5 10v10h14V10" />
    </Icon>
  );
}
function StreamsIcon() {
  return (
    <Icon>
      <path d="M3 12a9 9 0 0 1 18 0" />
      <path d="M7 12a5 5 0 0 1 10 0" />
      <circle cx="12" cy="12" r="1.5" />
    </Icon>
  );
}
function ReportsIcon() {
  return (
    <Icon>
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M16 4v4h4" />
      <path d="M8 14h8M8 18h5" />
    </Icon>
  );
}
function EventsIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </Icon>
  );
}
function WidgetsIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </Icon>
  );
}
function SettingsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 12.5c.1-.3.1-.6 0-.9l2-1.7-2-3.5-2.5.8c-.5-.4-1-.7-1.6-.9l-.4-2.5h-4l-.4 2.5c-.6.2-1.1.5-1.6.9l-2.5-.8-2 3.5 2 1.7c-.1.3-.1.6 0 .9l-2 1.7 2 3.5 2.5-.8c.5.4 1 .7 1.6.9l.4 2.5h4l.4-2.5c.6-.2 1.1-.5 1.6-.9l2.5.8 2-3.5z" />
    </Icon>
  );
}
