import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Poppins } from "next/font/google";
import "./globals.css";
import { InstalarApp } from "@/components/instalar-app";

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
  applicationName: "CIMBA",
  icons: {
    icon: "/marca/isotipo-smt.png",
    // Apple ignora el manifest: el ícono de la app instalada en iPhone sale
    // de acá, y sin alpha (iOS pinta negro donde hay transparencia).
    apple: "/icono/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "CIMBA",
    // La barra de estado translúcida deja que el color de la app llegue hasta
    // arriba; con "default" queda una banda blanca fija.
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  /**
   * El color de la barra del sistema con la app instalada, uno por tema: con
   * un solo valor claro, en oscuro quedaba una banda blanca arriba de una app
   * negra.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
  width: "device-width",
  initialScale: 1,
  /* La app instalada tiene que poder usar toda la pantalla del teléfono,
     incluida la zona del notch. */
  viewportFit: "cover",
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
        {/* Registra el service worker y, una sola vez, ofrece instalar la app
            y activar los avisos. Va en el layout raíz para que también lo vea
            el portal de empresas, que es el que más lo necesita. */}
        <InstalarApp />
      </body>
    </html>
  );
}
