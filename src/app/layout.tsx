import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "God's Master Dashboard",
  description: "Executive command center.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-surface dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
