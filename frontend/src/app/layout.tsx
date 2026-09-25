import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ConnectionGuard } from "@/components/common/ConnectionGuard";
import { themeScript } from "@/lib/theme-script";
import { I18nProvider } from "@/components/providers/I18nProvider";

// Self-hosted copies of the Google Fonts: the build environment cannot reach
// fonts.googleapis.com, and next/font/google fails the production build offline.
const instrumentSans = localFont({
  src: "./fonts/instrument-sans-latin.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-instrument-sans",
});

const bricolageGrotesque = localFont({
  src: "./fonts/bricolage-grotesque-latin.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-bricolage",
});

const splineSansMono = localFont({
  src: "./fonts/spline-sans-mono-latin.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-spline-mono",
});

// Classic skin fonts — loaded always, consumed only under data-skin='classic'
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Open Notebook",
  description: "Privacy-focused research and knowledge management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${instrumentSans.variable} ${bricolageGrotesque.variable} ${splineSansMono.variable} ${geistSans.variable} ${geistMono.variable} font-sans`}
      >
        <ErrorBoundary>
          <ThemeProvider>
            <QueryProvider>
              <I18nProvider>
                <ConnectionGuard>
                  {children}
                  <Toaster />
                </ConnectionGuard>
              </I18nProvider>
            </QueryProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
