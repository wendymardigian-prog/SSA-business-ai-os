import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "ZernFlow - The Open Source ManyChat Alternative",
    template: "%s | ZernFlow",
  },
  description:
    "Automate DMs, comments, and flows across Instagram, Facebook, WhatsApp, Telegram, X, Bluesky, and Reddit. Free, self-hostable, and open source.",
  metadataBase: new URL("https://zernflow.com"),
  openGraph: {
    title: "ZernFlow - The Open Source ManyChat Alternative",
    description:
      "Automate DMs, comments, and flows across Instagram, Facebook, WhatsApp, Telegram, X, Bluesky, and Reddit. Free, self-hostable, and open source.",
    url: "https://zernflow.com",
    siteName: "ZernFlow",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ZernFlow - The Open Source ManyChat Alternative",
    description:
      "Automate DMs, comments, and flows across 7 platforms. Free, self-hostable, open source.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Las dos preferencias que cambian como se ve la pantalla apenas carga:
          el tema y si el menu lateral esta colapsado. Se aplican como clase en
          el <html> desde aca, antes de que se pinte nada, porque si esperaran a
          que React hidrate se veria un parpadeo (claro que se pone oscuro, menu
          ancho que se achica).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="dark"||(!localStorage.getItem("theme")&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}
try{if(localStorage.getItem("sidebar-collapsed")==="1")document.documentElement.classList.add("sidebar-collapsed")}catch(e){}`,
          }}
        />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
