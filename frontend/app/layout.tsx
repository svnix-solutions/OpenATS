import type { Metadata } from "next";
import { Changa_One, Geist, Geist_Mono, Public_Sans } from "next/font/google";
import { AuthProvider } from "@/lib/auth/client";
import {
  publicConfig,
  publicConfigScript,
} from "@/lib/public-config";
import "./globals.css";

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-sans" });
const changaOne = Changa_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-changa-one",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenATS",
  description: "Open Source Applicant Tracking System",
};

export const dynamic = "force-dynamic";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeInitializer } from "@/components/theme/theme-initializer";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${changaOne.variable}`}
      suppressHydrationWarning
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-x-hidden`}
      >
        {/*
          The API and identity-provider origins, read from the environment on
          this render and handed to the browser.

          Before everything else on purpose: it is an inline script, so it runs
          as the document is parsed, which is before the deferred application
          bundle. Anything reading the configuration at import time therefore
          finds it already there.

          This layout is `force-dynamic`, so this reflects the environment the
          container was started with rather than the one it was built in.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: publicConfigScript(publicConfig()),
          }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeInitializer />
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
