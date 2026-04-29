import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://playlistfm.app";
const OG_IMAGE = `${SITE_URL}/api/og`;
const TITLE = "PlaylistFM — what's playing now, where they're playing next";
const DESCRIPTION =
  "Real-time playlist data plus tour-date discovery for public radio. Powered by Radio Milwaukee. Embeddable on any partner station's site.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "PlaylistFM",
    type: "website",
    images: [
      {
        // Live-generated OG via /api/og — pulls current Convex data,
        // so every social-share unfurl shows whatever's spinning right
        // now. Cached 60s edge-side; platforms cache for hours after.
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "PlaylistFM — now playing on Radio Milwaukee",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* General Sans from Fontshare — display / H1-H3 per DESIGN.md */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f%5B%5D=general-sans@500,600,700&display=swap"
        />
      </head>
      <body
        className="min-h-full flex flex-col bg-bg-base text-text-primary"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
