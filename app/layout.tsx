import type { Metadata, Viewport } from "next";
import { Manrope, Source_Code_Pro } from "next/font/google";
import "./globals.css";

/* The SOP's type pairing: Manrope for text, Source Code Pro for figures. */
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const mono = Source_Code_Pro({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "HOET Incentive calculator", template: "%s · HOET Incentive calculator" },
  description: "Monthly editor incentive calculation for House of EduTech.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#080808" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfb" },
  ],
};

/* Chooses the theme before the first paint, so a light-mode user never sees a
   dark flash. Same storage key as the Podcast SOP, so a person who picked a
   side there keeps it here. */
const themeScript = `try{var s=localStorage.getItem('hoet-theme');
document.documentElement.setAttribute('data-theme',s||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));
}catch(e){document.documentElement.setAttribute('data-theme','dark')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
