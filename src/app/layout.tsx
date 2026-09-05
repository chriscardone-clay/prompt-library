import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { Footer } from "@/components/Footer";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const roobert = localFont({
  src: "../../public/fonts/RoobertVF.ttf",
  variable: "--font-roobert",
  weight: "100 900",
  display: "swap",
});

const roobertMono = localFont({
  src: "../../public/fonts/RoobertSemiMonoVF.ttf",
  variable: "--font-roobert-mono",
  weight: "100 900",
  display: "swap",
});

const interTight = localFont({
  src: "../../public/fonts/InterTight-VariableFont_wght.ttf",
  variable: "--font-inter-tight",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Clay prompt library", template: "%s · Clay prompt library" },
  description:
    "Good prompts, shared once. Used everywhere. Find a prompt, fill in the blanks, paste it into Town, Claude, ChatGPT or Claygent.",
  // Icons come from src/app/icon.png, src/app/apple-icon.png and public/favicon.ico.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FEFDFB" },
    { media: "(prefers-color-scheme: dark)", color: "#141311" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // data-embedded is added by the inline script below before hydration.
      suppressHydrationWarning
      className={`${roobert.variable} ${roobertMono.variable} ${interTight.variable}`}
      style={{
        // Expose the Terra font tokens on the root so plain CSS can use them.
        ["--font-display" as string]:
          "var(--font-roobert), var(--font-inter-tight), system-ui, sans-serif",
        ["--font-body" as string]:
          "var(--font-roobert), var(--font-inter-tight), system-ui, sans-serif",
        ["--font-mono" as string]:
          "var(--font-roobert-mono), 'JetBrains Mono', ui-monospace, monospace",
      }}
    >
      <head>
        {/* Before first paint: mark the document when it's embedded in an iframe
            (e.g. a Notion page) so the compact layout renders without a flash,
            and resolve the appearance preference (localStorage "theme": light |
            dark | system) to data-theme so dark mode doesn't flash light. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(window.self!==window.top)document.documentElement.setAttribute('data-embedded','')}catch(e){document.documentElement.setAttribute('data-embedded','')}" +
              "try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){}",
          }}
        />
      </head>
      <body>
        <ToastProvider>
          {children}
          <Suspense fallback={null}>
            <Footer />
          </Suspense>
        </ToastProvider>
      </body>
    </html>
  );
}
