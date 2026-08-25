import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "Executive Dashboard",
    template: "%s · Executive Dashboard",
  },
  description:
    "A private executive dashboard: tasks, mail, calendar, notes and time in one place.",
  applicationName: "Executive Dashboard",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Dashboard",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180" }],
  },
  // The app is reachable only over the tailnet, but belt and braces.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The navy chrome, so the phone's status bar and the PWA splash match the
  // frame rather than the page. Both entries are dark-ish for the same reason
  // the frame is: it is the constant.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#10213F" },
    { media: "(prefers-color-scheme: dark)", color: "#0C1629" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` because the boot script stamps `data-theme`
    // on this element before React arrives, so the server's markup and the
    // client's genuinely differ by that one attribute. Scoped to <html>, so
    // it hides nothing else.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* No nonce: the CSP authorises this script by its hash instead, so
            that the root layout does not have to read `headers()` and drag
            every route in the application into dynamic rendering. See the
            note beside THEME_BOOT_SCRIPT_HASH. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
