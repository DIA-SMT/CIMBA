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
  themeColor: "#EEF2F7",
  width: "device-width",
  initialScale: 1,
};

/**
 * El tema se resuelve ANTES del primer frame con un script inline: sin él, un
 * usuario en oscuro vería un destello claro en cada navegación. El default es
 * claro (trabajo de oficina); el atributo data-tema en <html> es lo único que
 * miran el CSS (tokens) y el mapa (MutationObserver).
 */
const SCRIPT_TEMA = `try{var t=localStorage.getItem("cimba-tema");if(t==="oscuro")document.documentElement.dataset.tema="oscuro"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" data-tema="claro" className={`${poppins.variable} ${jbmono.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        {children}
      </body>
    </html>
  );
}
