import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
});

const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jbmono",
});

export const metadata: Metadata = {
  title: "CIMBA · Centro Inteligente de Monitoreo de Baches y Asfalto",
  description:
    "Sistema de gestión de bacheo y reparación de pavimento — Municipalidad de San Miguel de Tucumán",
  icons: { icon: "/marca/isotipo-smt.png" },
};

export const viewport: Viewport = {
  themeColor: "#070A10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${poppins.variable} ${jbmono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
