import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { listarEmpresas } from "@/lib/ordenes";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { BotonClave } from "./boton-clave";
import { CeldaDotacion } from "./celda-dotacion";

export const dynamic = "force-dynamic";

export default async function PaginaEmpresas() {
  const sesion = (await leerSesion())!;
  const empresas = await listarEmpresas(sesion);
  const puedePlanificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link
        href="/ordenes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto"
      >
        <ArrowLeft size={15} /> Órdenes
      </Link>
      <TituloPagina
        titulo="Empresas contratistas"
        sub="Quién trabaja, con cuánta dotación, y el acceso de cada una a su portal."
      />

      <Panel className="mb-4 p-4 text-sm leading-relaxed text-texto-2">
        <b className="text-texto">El circuito de acceso:</b> acá generás la clave de cada empresa (se
        muestra una sola vez) y se la pasás a su referente por el canal que prefieras. La empresa entra
        por la pantalla de acceso de siempre (<code className="rounded bg-panel-3 px-1 text-xs">/acceso</code>)
        con el <b>usuario</b> que ves en la tabla y esa clave, y cae directo en su portal, donde ve las
        órdenes emitidas y carga cada bache con medidas y foto. Con <b>ver su portal</b> lo mirás
        exactamente como lo ve la empresa.
      </Panel>

      <Panel className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Usuario</th>
              <th className="num px-4 py-3 text-right">Cuadrillas</th>
              <th className="num px-4 py-3 text-right">Turnos/día</th>
              <th className="px-4 py-3">Circuitos asignados</th>
              <th className="num px-4 py-3 text-right" title="Items pendientes en órdenes emitidas o en ejecución">
                Carga actual
              </th>
              <th className="px-4 py-3">Clave</th>
              <th className="px-4 py-3">Portal</th>
              {puedePlanificar && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id} className={`border-b border-borde/60 transition hover:bg-panel-2 ${!e.activa ? "opacity-50" : ""}`}>
                <td className="px-4 py-2.5 font-semibold">
                  {e.nombre}
                  {!e.activa && <span className="ml-2 text-[10px] font-normal text-texto-3">inactiva</span>}
                </td>
                <td className="px-4 py-2.5">
                  <code className="rounded bg-panel-3 px-1.5 py-0.5 text-xs text-texto-2">{e.slug}</code>
                </td>
                {/* La dotación "va variando": quien planifica la corrige acá mismo
                    (guarda al blur/Enter); el resto la ve como número. */}
                <td className="px-4 py-2.5 text-right">
                  {puedePlanificar ? (
                    <CeldaDotacion empresaId={e.id} campo="cuadrillas" valor={e.cuadrillas} min={1} max={20} />
                  ) : (
                    <span className="num">{numero(e.cuadrillas)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {puedePlanificar ? (
                    <CeldaDotacion empresaId={e.id} campo="turnosPorDia" valor={e.turnosPorDia} min={1} max={4} />
                  ) : (
                    <span className="num">{numero(e.turnosPorDia)}</span>
                  )}
                </td>
                <td className="max-w-48 truncate px-4 py-2.5 text-xs text-texto-2" title={e.circuitosAsignados.join(", ")}>
                  {e.circuitosAsignados.length > 0 ? e.circuitosAsignados.join(", ") : "—"}
                </td>
                <td className="num px-4 py-2.5 text-right font-bold" style={{ color: e.itemsPendientes > 0 ? "#d95926" : "#5c6b84" }}>
                  {numero(e.itemsPendientes)}
                  {e.ordenesActivas > 0 && (
                    <span className="ml-1 font-normal text-texto-3">
                      ({numero(e.ordenesActivas)} OT)
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {e.tieneClave ? (
                    <span style={{ color: "#199e70" }}>sí</span>
                  ) : (
                    <span className="text-amarillo">sin clave</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/empresa?empresa=${e.id}`}
                    title="Vista espejo: ver el portal exactamente como lo ve esta empresa"
                    className="text-xs font-semibold whitespace-nowrap text-celeste hover:underline"
                  >
                    ver su portal →
                  </Link>
                </td>
                {puedePlanificar && (
                  <td className="px-4 py-2.5">
                    <BotonClave empresaId={e.id} tieneClave={e.tieneClave} />
                  </td>
                )}
              </tr>
            ))}
            {empresas.length === 0 && (
              <tr>
                <td colSpan={puedePlanificar ? 9 : 8} className="px-4 py-10 text-center text-texto-3">
                  No hay empresas cargadas todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
