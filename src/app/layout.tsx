import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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
  icons: { icon: "/brand/Clay_Arch_3D.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#FEFDFB",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
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
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
