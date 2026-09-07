import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: { default: "StonkFun Metrics", template: "%s · StonkFun Metrics" },
  description: "Live on-chain metrics for the StonkFun launchpad on Solana: tokens, volume, revenue, buybacks and burns.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
        <footer className="border-t border-border mt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
            <span>Data: StonkFun public API (unofficial dashboard, not affiliated).</span>
            <span>USD figures are StonkFun&apos;s own pricing; verify against on-chain sources before relying on them.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
