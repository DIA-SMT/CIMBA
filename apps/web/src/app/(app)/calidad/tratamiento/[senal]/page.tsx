import Link from "next/link";
import { notFound } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { demandasPorSenal, diagnosticoDemandas, type SenalTratamiento } from "@/lib/tratamiento";
import { ETIQUETA_FUENTE, ETIQUETA_TIPO, fechaCorta, numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { ChipMiniMapa } from "@/components/mapa/mini-mapa";
import { AccionSenal } from "./accion-senal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * La bandeja de UNA señal del tratamiento: el sistema ya cruzó cada reclamo
 * contra la red vial, las reparaciones y los otros reclamos; acá una persona
 * confirma (o no) lo que saltó, caso por caso y con el mini-mapa a mano.
 */
const SENALES: Record<
  SenalTratamiento,
  { titulo: string; sub: string; regla: string; accionMasiva?: { href: string; texto: string } }
> = {
  no_es_bache: {
    titulo: "No es bache: calle de ripio",
    sub: "Reclamos tipificados como bache o pavimento que caen donde NO hay pavimento (ripio o cordón cuneta a metros, según la red vial real).",
    regla:
      "Ahí no se bachea: es pasado de máquina. Confirmá cada caso para derivarlo a Ingeniería — o abrí el mini-mapa si el punto parece mal geocodificado.",
  },
  duplicada: {
    titulo: "Posibles duplicadas",
    sub: "Reclamos abiertos con OTRO reclamo anterior del mismo tipo a menos de 15 metros.",
    regla:
      "Descartar el pedido de un vecino es una decisión con nombre y apellido: el sistema te deja la referencia y la distancia servidas, pero la confirmás vos, una por una. El original sigue abierto y junta la prioridad de ambos.",
  },
  ya_resuelta: {
    titulo: "Parecen ya resueltas",
    sub: "Reclamos con una reparación registrada DESPUÉS del pedido, a menos de 25 metros del punto.",
    regla:
      "Si la obra efectivamente lo atendió, el reclamo se vincula a ese incidente (no se descarta: queda respondible al vecino con la reparación que lo cubrió).",
  },
  derivar_sat: {
    titulo: "Para la S.A.T.",
    sub: "Pérdidas de agua, tapas de registro y sumideros: no son del municipio, se derivan a la Sociedad Aguas del Tucumán.",
    regla:
      "Estos no se tocan de a uno: se derivan TODOS juntos con la nota administrativa numerada al Director de la S.A.T. — así siempre queda el expediente registrado. La nota incluye además los reclamos de agua sin ubicación (acá se listan solo los georreferenciados).",
    accionMasiva: { href: "/expedientes/sat", texto: "Previsualizar y registrar la nota a la S.A.T. →" },
  },
};

export default async function PaginaSenal({ params }: { params: Promise<{ senal: string }> }) {
  const { senal } = await params;
  // hasOwn y no `in`: /calidad/tratamiento/constructor pasaba por la cadena
  // de prototipos y terminaba en 500 en vez de 404.
  if (!Object.hasOwn(SENALES, senal)) notFound();
  const s = senal as SenalTratamiento;
  const info = SENALES[s];

  const sesion = (await leerSesion())!;
  const [filas, diag] = await Promise.all([demandasPorSenal(sesion, s), diagnosticoDemandas(sesion)]);
  // El título dice el total REAL de la señal; el listado se corta en 300.
  const total = { no_es_bache: diag.noEsBache, duplicada: diag.duplicadas, ya_resuelta: diag.yaResueltas, derivar_sat: diag.derivarSat }[s];
  const puedeActuar = ["admin", "planificacion", "atencion_ciudadana"].includes(sesion.rol_cimba);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Link href="/calidad" className="text-sm text-texto-2 hover:text-texto">
        ← Tratamiento de la demanda
      </Link>
      <div className="mt-2">
        <TituloPagina titulo={`${info.titulo} (${numero(total)})`} sub={info.sub} />
      </div>

      <Panel className="mb-5 p-4 text-[13px] leading-relaxed text-texto-2">
        {info.regla}
        {info.accionMasiva && (
          <div className="mt-3">
            <Link
              href={info.accionMasiva.href}
              className="inline-block rounded-xl bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              {info.accionMasiva.texto}
            </Link>
          </div>
        )}
      </Panel>

      {filas.length < total && (
        <p className="mb-3 text-xs text-texto-3">
          Se muestran los {numero(filas.length)} más recientes de {numero(total)}: al confirmar casos van entrando los demás.
        </p>
      )}

      {filas.length === 0 ? (
        <p className="rounded-xl border border-borde bg-panel px-4 py-10 text-center text-sm text-texto-3">
          No hay reclamos con esta señal. La cola está limpia.
        </p>
      ) : (
        <div className="space-y-2">
          {filas.map((d) => (
            <Panel key={d.id} className="p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-56 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-bold">#{d.id}</span>
                    <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] font-semibold text-texto-2">
                      {d.tipo ? ETIQUETA_TIPO[d.tipo] : "Sin tipo"}
                    </span>
                    <span className="text-[11px] text-texto-3">
                      {ETIQUETA_FUENTE[d.fuente as keyof typeof ETIQUETA_FUENTE] ?? d.fuente} · {fechaCorta(d.creadoEn)}
                      {d.tieneFoto && " · 📷"}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-texto">
                    {d.direccion ?? "Sin dirección"}
                    {d.barrio && <span className="text-texto-3"> — {d.barrio}</span>}
                  </div>
                  {d.detalle && <div className="mt-1 text-xs font-medium text-amarillo">{d.detalle}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ChipMiniMapa lat={d.lat} lon={d.lon} etiqueta={d.direccion} />
                  <Link
                    href={`/demandas/${d.id}`}
                    className="rounded-lg border border-borde-2 px-2.5 py-1.5 text-xs font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
                  >
                    Ficha
                  </Link>
                  {puedeActuar && s !== "derivar_sat" && (
                    <AccionSenal senal={s} demandaId={d.id} referenciaId={d.referenciaId} />
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
