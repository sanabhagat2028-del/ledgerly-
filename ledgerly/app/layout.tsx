import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./app.css";

export const metadata: Metadata = {
  title: "Ledgerly: your bank SMS, kept like a khata",
  description:
    "Paste your bank SMS. Ledgerly turns the noise into a monthly khata of where your money went, which subscriptions to cancel, and how much you could save.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@500&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
          <filter id="rough">
            <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
          </filter>
        </svg>
        {children}
      </body>
    </html>
  );
}
