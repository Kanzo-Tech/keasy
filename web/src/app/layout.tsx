import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { Nav } from "@/components/nav";
import { PreferencesProvider } from "@/components/preferences-provider";
import { SWRProvider } from "@/components/swr-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

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

export const metadata: Metadata = {
  title: "Keasy Dashboard",
  description: "Monitor and manage Keasy jobs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`h-full ${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="h-full overflow-hidden font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          <TooltipProvider>
            <SWRProvider>
              <PreferencesProvider>
            <div className="flex h-full">
              <Nav />
              <main className="flex-1 min-h-0 min-w-0 overflow-y-auto">
                <div className="max-w-5xl mx-auto p-6">{children}</div>
              </main>
            </div>
            <Toaster position="bottom-right" closeButton />
              </PreferencesProvider>
            </SWRProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
