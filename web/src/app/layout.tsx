import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@kanzo-tech/ui";
import { currentBranding } from "@/lib/branding";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await currentBranding();
  return { title: name, description: "Monitor and manage Keasy graphs" };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branding = await currentBranding();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full ${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      {/* The operator's stylesheet, declared per organization — trusted configuration, not user input. */}
      {branding.theme_css && (
        <head>
          <style dangerouslySetInnerHTML={{ __html: branding.theme_css }} id="keasy-brand" />
        </head>
      )}
      <body className="h-full font-sans antialiased">
        <Providers branding={branding}>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
