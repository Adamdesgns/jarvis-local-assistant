import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://jarvis-private-ai.netlify.app"),
  title: "JARVIS + JARVIS JR — Private AI for the whole family",
  description:
    "Meet JARVIS and JARVIS JR: free, private Windows assistants for adults and kids, connected through parent-controlled family calls.",
  icons: {
    icon: "/jarvis-core.svg",
    shortcut: "/jarvis-core.svg",
  },
  openGraph: {
    title: "JARVIS + JARVIS JR — Private AI for the whole family",
    description:
      "Free on Windows. Explore the adult command center, JARVIS JR games, parent controls, and Call Dad demo.",
    type: "website",
    images: [{ url: "/og.png", width: 1730, height: 909 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "JARVIS + JARVIS JR — Private AI for the whole family",
    description: "Free on Windows. Private by architecture. Parent-controlled where it matters.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
