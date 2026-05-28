import type { Metadata } from "next";
import {
  Archivo,
  Fraunces,
  Geist,
  Inter,
  JetBrains_Mono,
  Manrope,
  Sora,
  Source_Serif_4,
  Space_Grotesk,
} from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

// Curated theme fonts — self-hosted, exposed as CSS variables referenced by the
// `font` token stacks in lib/fonts.ts. next/font only downloads a face's woff2
// when text actually renders in it, so declaring all of them is cheap on public
// pages (one font) and acceptable on the theme manager (previews each).
const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"] });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"] });
const jetBrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

const fontVariables = [
  geistSans.variable,
  inter.variable,
  manrope.variable,
  spaceGrotesk.variable,
  sora.variable,
  archivo.variable,
  fraunces.variable,
  sourceSerif.variable,
  jetBrainsMono.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Radio Milwaukee — Station Microsites",
  description:
    "Themeable microsites and campaign pages for HYFIN, 88Nine, and Rhythm Lab. Powered by Radio Milwaukee.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <head>
        {/* General Sans (Fontshare) — display face referenced by theme tokens. */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f%5B%5D=general-sans@500,600,700&display=swap"
        />
      </head>
      <body className="min-h-full" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
