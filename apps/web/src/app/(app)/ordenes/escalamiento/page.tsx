import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { ETIQUETA_ESCALA, ETIQUETA_MOTIVO, UMBRALES, cuadrasEscalables } from "@/lib/escalamiento";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Las cuadras que dejaron de ser un problema de mantenimiento. Es la lista
 * que el Plan de Acción pide producir todos los trimestres y que hoy nadie
 * arma: sin ella, una cuadra se bachea cinco veces al año y nunca escala a
 * la obra que necesita.
 */
export default async function PaginaEscalamiento() {
  const sesion = (await leerSesion())!;
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-sm text-texto-3">
        Esta pantalla es de planificación.
      </div>
    );
  }

  const cuadras = await cuadrasEscalables(sesion);
  const tipoA = cuadras.filter((c) => c.escala === "A");
  const tipoC = cuadras.filter((c) => c.escala === "C");
  const hidraulica = cuadras.filter((c) => c.escala === "hidraulica");
  const m2Total = cuadras.reduce((s, c) => s + c.m2Reparados, 0);

  const grupos = [
    { clave: "A" as const, lista: tipoA },
    { clave: "hidraulica" as const, lista: hidraulica },
    { clave: "C" as const, lista: tipoC },
  ];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link href="/ordenes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto">
        <ArrowLeft size={15} /> Órdenes
      </Link>
      <TituloPagina
        titulo="Cuadras que ya no se bachean"
        sub="Dónde seguir parchando es tirar plata. Son los criterios de escalamiento de la Dirección de Obras Viales aplicados a lo que realmente pasó en la calle."
      />

      <Panel className="mb-5 p-4 text-[13px] leading-relaxed text-texto-2">
        <b className="text-texto">La regla.</b> Hasta tres baches por cuadra y sin reincidencia, se bachea y
        listo. Cuando se bacheó <b>más del {UMBRALES.porcentajeCuadra}% de la cuadra en 24 meses</b> o hubo{" "}
        <b>{UMBRALES.reaperturas} o más reaperturas en 12 meses</b>, el problema es estructural y corresponde
        una <b>Obra Tipo C</b> (paños de hormigón o cordón cuneta). Si además hay{" "}
        <b>{UMBRALES.cuadrasContiguas} cuadras seguidas</b> en esa situación, ya no es una cuadra: es un
        tramo, y va a <b>Obra Tipo A</b> — repavimentación, que entra al ranking IPI del sector.
        <span className="mt-2 block">
          Donde hay <b>anegamiento</b>, la norma manda estudio hidráulico o cordón cuneta{" "}
          <b>antes</b> de tocar la calzada: si la causa es el agua, el asfalto nuevo dura una temporada.
        </span>
        <span className="mt-2 block text-texto-3">
          El porcentaje de cuadra se estima con un ancho de calzada de 7 m, que es la de dos manos típica —
          la red vial es una línea y no trae ancho. Falta un criterio del protocolo: «piel de cocodrilo en
          más del 20% del tramo», que exige clasificar la patología de cada foto.
        </span>
      </Panel>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel className="p-4">
          <p className="num text-2xl font-bold" style={{ color: "var(--color-sin-atencion)" }}>{numero(tipoA.length)}</p>
          <p className="text-[11px] tracking-wide text-texto-3 uppercase">a repavimentar (Tipo A)</p>
        </Panel>
        <Panel className="p-4">
          <p className="num text-2xl font-bold" style={{ color: "var(--color-en-cola)" }}>{numero(tipoC.length)}</p>
          <p className="text-[11px] tracking-wide text-texto-3 uppercase">a Obra Tipo C</p>
        </Panel>
        <Panel className="p-4">
          <p className="num text-2xl font-bold" style={{ color: "#4d7cfe" }}>{numero(hidraulica.length)}</p>
          <p className="text-[11px] tracking-wide text-texto-3 uppercase">estudio hidráulico</p>
        </Panel>
        <Panel className="p-4">
          <p className="num text-2xl font-bold">{numero(Math.round(m2Total))}</p>
          <p className="text-[11px] tracking-wide text-texto-3 uppercase">m² ya gastados ahí</p>
        </Panel>
      </div>

      {cuadras.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-texto-3">
          Ninguna cuadra alcanza todavía los umbrales de escalamiento. Es una buena noticia: se está
          bacheando sin repetir.
        </Panel>
      ) : (
        grupos.map(({ clave, lista }) => {
          if (lista.length === 0) return null;
          const e = ETIQUETA_ESCALA[clave];
          return (
            <Panel key={clave} className="mb-4 overflow-x-auto p-0">
              <div className="px-5 pt-4 pb-2">
                <p className="text-sm font-bold">
                  {e.titulo}
                  <span className="ml-2 text-[11px] font-normal text-texto-3">{e.detalle}</span>
                </p>
              </div>
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
                    <th className="px-5 py-2">Cuadra</th>
                    <th className="px-3 py-2">Por qué escala</th>
                    <th className="px-3 py-2 text-right" title="Porcentaje de la calzada ya bacheado en 24 meses">
                      % bacheado
                    </th>
                    <th className="px-3 py-2 text-right">Reparaciones</th>
                    <th className="px-3 py-2 text-right">Reaperturas</th>
                    <th className="px-3 py-2 text-right">m² gastados</th>
                    <th className="px-5 py-2 text-right">Ver</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.slice(0, 60).map((c) => (
                    <tr key={c.id} className="border-b border-borde/60">
                      <td className="px-5 py-2.5">
                        <span className="font-semibold">{c.direccion ?? `Cuadra #${c.id}`}</span>
                        {c.barrio && <span className="block text-[11px] text-texto-3">{c.barrio}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] leading-snug text-texto-2">
                        {c.motivos.map((m) => ETIQUETA_MOTIVO[m]).join(" · ")}
                      </td>
                      <td className="num px-3 py-2.5 text-right font-bold">{c.porcentajeCuadra.toFixed(0)}%</td>
                      <td className="num px-3 py-2.5 text-right">{numero(c.reparaciones)}</td>
                      <td className="num px-3 py-2.5 text-right" style={{ color: c.reaperturas >= UMBRALES.reaperturas ? "var(--color-sin-atencion)" : undefined }}>
                        {numero(c.reaperturas)}
                      </td>
                      <td className="num px-3 py-2.5 text-right text-texto-2">{numero(Math.round(c.m2Reparados))}</td>
                      <td className="px-5 py-2.5 text-right">
                        <Link
                          href={`/mapa?lat=${c.lat}&lon=${c.lon}&z=18`}
                          className="text-xs font-semibold text-celeste hover:underline"
                        >
                          ver →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lista.length > 60 && (
                <p className="px-5 py-3 text-[11px] text-texto-3">
                  Se muestran las 60 primeras de {numero(lista.length)}, ordenadas por porcentaje bacheado.
                </p>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
