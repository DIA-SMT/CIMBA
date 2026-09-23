import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { datosAvance, leerCamara, leerTerritorio, listarTerritorios, ventanaValida } from "@/lib/avance";
import { LogoCimba } from "@/components/marca";
import { BotonTema } from "@/components/boton-tema";
import { PantallaAvance } from "@/app/(app)/avance/pantalla-avance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Avance de bacheo · San Miguel de Tucumán",
  description:
    "Qué se reparó, quién lo hizo y qué se está haciendo ahora en las calles de San Miguel de Tucumán. Datos en vivo del sistema CIMBA.",
};

/**
 * AVANCE PARA AFUERA. La misma pantalla que ve la Dirección, sin sesión, para
 * mostrarle a la ciudad lo que se hizo con su plata: cada trabajo en el mapa,
 * las cifras del mes, las fotos del antes y el después, y lo pendiente al
 * lado, porque la honestidad es lo que hace creíble lo positivo.
 *
 * Lo que NO trae: nombres de personas (ni del municipio ni de los vecinos),
 * direcciones de los pedidos que esperan, el feed de movimientos, y ningún
 * link hacia adentro del sistema.
 *
 * Solo existe con la llave AVANCE_PUBLICO=1 en el hosting. Sin ella, 404: la
 * decisión de abrir esto es de la Dirección, no del código.
 */
export default async function PaginaPublica({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; distrito?: string; barrio?: string; empresa?: string; c?: string }>;
}) {
  if (process.env.AVANCE_PUBLICO !== "1") notFound();

  const sp = await searchParams;
  const [datos, territorios] = await Promise.all([
    datosAvance(null, { dias: ventanaValida(sp.dias), territorio: leerTerritorio(sp), publico: true }),
    listarTerritorios(),
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-fondo">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-borde bg-panel px-4">
        <LogoCimba />
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-texto-2 md:block">
            Avance de bacheo · datos en vivo, se renuevan solos cada minuto
          </p>
          <BotonTema compacto />
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <PantallaAvance
          inicial={datos}
          rol="lectura"
          territorios={territorios}
          empresaInicial={sp.empresa?.trim().slice(0, 40) || null}
          camaraInicial={leerCamara(sp.c)}
          publico
        />
      </div>
    </div>
  );
}
