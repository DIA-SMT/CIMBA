import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { obtenerCapacidad } from "@/lib/ordenes";
import { productividad } from "@/lib/productividad";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { PanelTabla } from "@/components/tabla-deslizable";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[(m ?? 1) - 1]} ${a}`;
};

/**
 * Productividad: "poder validar cuántos baches se hacen por día, por mes"
 * (el Director, 5/9). Todo sale de intervenciones FINALIZADAS — con foto y
 * medidas — y se compara contra su propia regla de capacidad, así el informe
 * dice si el ritmo real está a la altura del teórico.
 */
export default async function PaginaProductividad() {
  const sesion = (await leerSesion())!;
  const [p, cap] = await Promise.all([productividad(sesion), obtenerCapacidad(sesion)]);

  const baches30 = p.porDia.reduce((s, d) => s + d.baches, 0);
  const m2_30 = p.porDia.reduce((s, d) => s + d.m2, 0);
  const diasConTrabajo = p.porDia.filter((d) => d.baches > 0).length;
  const promedioDia = diasConTrabajo > 0 ? Math.round((baches30 / diasConTrabajo) * 10) / 10 : 0;
  // La vara del Director: baches por cuadrilla y por día, de la regla cargada.
  const varaCuadrillaDia = cap.bachesPorTurno * cap.turnosPorDia;
  const maxDia = Math.max(1, ...p.porDia.map((d) => d.baches));

  // Los meses presentes, más nuevos primero; los ejecutores, por total.
  const meses = [...new Set(p.porMes.map((f) => f.mes))].sort().reverse();
  const ejecutores = [...new Set(p.porMes.map((f) => f.ejecutor))];
  const totalDe = (e: string) => p.porMes.filter((f) => f.ejecutor === e).reduce((s, f) => s + f.baches, 0);
  ejecutores.sort((a, b) => totalDe(b) - totalDe(a));
  const celda = (e: string, m: string) => p.porMes.find((f) => f.ejecutor === e && f.mes === m);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Link href="/ordenes" className="text-sm text-texto-2 hover:text-texto">← Órdenes</Link>
      <TituloPagina
        titulo="Productividad"
        sub="Cuántos baches se hacen por día y por mes, por ejecutor — solo trabajo finalizado con foto y medidas."
      />

      {/* Los números de los últimos 30 días */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra n={numero(baches30)} etiqueta="Baches (30 días)" />
        <Cifra n={numero(promedioDia)} etiqueta="Promedio por día activo" />
        <Cifra n={`${numero(m2_30)} m²`} etiqueta="Superficie (30 días)" />
        <Cifra
          n={numero(varaCuadrillaDia)}
          etiqueta="La vara: baches/día por cuadrilla"
          ayuda={`La regla de capacidad cargada: ${cap.bachesPorTurno} baches por turno × ${cap.turnosPorDia} turnos. Se edita en Órdenes → Capacidad.`}
        />
      </div>

      {/* Por día: el pulso de los últimos 30 días */}
      <Panel className="mb-6 p-5">
        <p className="mb-3 text-sm font-bold">Baches por día — últimos 30 días</p>
        {p.porDia.length === 0 ? (
          <p className="text-sm text-texto-3">Sin trabajo finalizado en los últimos 30 días.</p>
        ) : (
          <div className="flex h-32 items-end gap-[3px]">
            {p.porDia.map((d) => (
              <div
                key={d.dia}
                className="group relative min-w-0 flex-1 rounded-t bg-celeste/70 transition hover:bg-celeste"
                style={{ height: `${Math.max(4, (100 * d.baches) / maxDia)}%` }}
                title={`${d.dia.split("-").reverse().join("/")}: ${d.baches} bache(s) · ${numero(d.m2)} m²`}
              >
                <span className="num absolute -top-4 left-1/2 hidden -translate-x-1/2 text-[9px] font-bold text-texto-2 group-hover:block">
                  {d.baches}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-texto-3">
          Pasá el mouse por una barra para ver el día. Un día sin barra es un día sin trabajo reportado.
        </p>
      </Panel>

      {/* Por ejecutor, últimos 30 días */}
      <PanelTabla className="mb-6 p-0">
        <p className="px-5 pt-4 pb-2 text-sm font-bold">Por ejecutor — últimos 30 días</p>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
              <th className="px-5 py-2">Ejecutor</th>
              <th className="px-3 py-2 text-right">Baches</th>
              <th className="px-3 py-2 text-right">m²</th>
              <th className="px-3 py-2 text-right">m³</th>
              <th className="px-3 py-2 text-right">Días activos</th>
              <th className="px-5 py-2 text-right" title="Baches por día activo, contra la vara de capacidad">Ritmo</th>
            </tr>
          </thead>
          <tbody>
            {p.ultimos30.map((e) => {
              const ritmo = e.diasActivos > 0 ? Math.round((e.baches / e.diasActivos) * 10) / 10 : 0;
              return (
                <tr key={e.ejecutor} className="border-b border-borde/60">
                  <td className="px-5 py-2.5 font-semibold">{e.ejecutor}</td>
                  <td className="num px-3 py-2.5 text-right font-bold">{numero(e.baches)}</td>
                  <td className="num px-3 py-2.5 text-right">{numero(e.m2)}</td>
                  <td className="num px-3 py-2.5 text-right">{e.m3 > 0 ? numero(e.m3) : "—"}</td>
                  <td className="num px-3 py-2.5 text-right">{e.diasActivos}</td>
                  <td className="num px-5 py-2.5 text-right">
                    {ritmo}/día{" "}
                    <span className={ritmo >= varaCuadrillaDia ? "text-resuelto" : "text-texto-3"}>
                      {ritmo >= varaCuadrillaDia ? "✓" : `(vara: ${varaCuadrillaDia})`}
                    </span>
                  </td>
                </tr>
              );
            })}
            {p.ultimos30.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-texto-3">Sin trabajo en los últimos 30 días.</td></tr>
            )}
          </tbody>
        </table>
      </PanelTabla>

      {/* Por mes × ejecutor: la foto grande */}
      <PanelTabla className="p-0">
        <p className="px-5 pt-4 pb-2 text-sm font-bold">Por mes — últimos 6 meses (baches · m²)</p>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
              <th className="px-5 py-2">Ejecutor</th>
              {meses.map((m) => (
                <th key={m} className="px-3 py-2 text-right">{nombreMes(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ejecutores.map((e) => (
              <tr key={e} className="border-b border-borde/60">
                <td className="px-5 py-2.5 font-semibold">{e}</td>
                {meses.map((m) => {
                  const c = celda(e, m);
                  return (
                    <td key={m} className="num px-3 py-2.5 text-right">
                      {c ? (
                        <>
                          <b>{numero(c.baches)}</b>
                          <span className="text-[11px] text-texto-3"> · {numero(c.m2)} m²</span>
                        </>
                      ) : (
                        <span className="text-texto-3">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[11px] text-texto-3">
          Cuenta solo intervenciones finalizadas con fecha. El m³ sale de las medidas reales (superficie ×
          espesor); el histórico sin espesor no lo inventa.
        </p>
      </PanelTabla>
    </div>
  );
}

function Cifra({ n, etiqueta, ayuda }: { n: string; etiqueta: string; ayuda?: string }) {
  return (
    <Panel className="p-4" >
      <div title={ayuda} className={ayuda ? "cursor-help" : undefined}>
        <div className="num text-2xl font-extrabold text-celeste">{n}</div>
        <div className="mt-0.5 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">{etiqueta}</div>
      </div>
    </Panel>
  );
}
