import type { RenglonNota } from "@/lib/expedientes";

/**
 * La NOTA administrativa a la SAT, como documento: membrete, destinatario,
 * cuerpo formal, el detalle de los reclamos con georreferencia y fotografía, y
 * pie de firma. La MISMA pieza renderiza la previsualización (borrador) y la
 * nota registrada — lo único que cambia es la cabecera de estado.
 *
 * En papel manda la sobriedad: tipografía serif, blanco y negro, una foto por
 * reclamo a tamaño de acta. Sin colores del sistema: esto lo lee otra
 * repartición.
 */

/** CSS de impresión de la nota: lo usan la previsualización y la registrada. */
export const CSS_IMPRESION_NOTA = `
@media print {
  @page { margin: 14mm; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > div { display: block !important; height: auto !important; overflow: visible !important; }
  main { overflow: visible !important; }
  header, nav { display: none !important; }
  body * { visibility: hidden; }
  .nota-administrativa, .nota-administrativa * { visibility: visible; }
  .nota-administrativa { position: absolute; top: 0; left: 0; width: 100%; color: #000 !important; background: #fff !important; }
}
`;

const ETIQUETA_TIPO_NOTA: Record<string, string> = {
  perdida_agua: "Pérdida de agua",
  tapa_registro: "Tapa de registro",
  sumidero: "Sumidero",
  bache: "Bache",
  hundimiento: "Hundimiento",
  pavimento_deteriorado: "Pavimento deteriorado",
  fisura: "Fisura",
  otro: "Otro",
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function fechaLarga(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function NotaSat({
  numero,
  fechaIso,
  destinatario,
  observaciones,
  renglones,
  generadoPor,
}: {
  /** null = borrador de previsualización, todavía sin número. */
  numero: string | null;
  fechaIso?: string;
  destinatario: string;
  observaciones?: string | null;
  renglones: RenglonNota[];
  generadoPor?: string | null;
}) {
  return (
    <div
      className="nota-administrativa mx-auto max-w-3xl rounded-xl border border-borde bg-panel p-8 text-[15px] leading-relaxed print:max-w-none print:rounded-none print:border-0 print:p-0"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      {/* Membrete */}
      <div className="mb-8 border-b border-borde-2 pb-4 text-center print:border-black">
        <p className="text-[13px] font-bold tracking-[0.18em] uppercase">
          Municipalidad de San Miguel de Tucumán
        </p>
        <p className="text-[12px] tracking-wider text-texto-2 uppercase print:text-black">
          Secretaría de Obras Públicas — Dirección de Bacheo
        </p>
      </div>

      <div className="mb-6 flex items-baseline justify-between gap-4">
        <p className="font-bold">{numero ?? "NOTA N° — (borrador, sin registrar)"}</p>
        <p>San Miguel de Tucumán, {fechaLarga(fechaIso)}</p>
      </div>

      <div className="mb-6">
        <p className="font-bold uppercase">Al Sr. Director de la S.A.T.</p>
        <p className="font-bold uppercase">{destinatario.replace(/ — .*$/, "")}</p>
        <p className="mt-1 tracking-[0.3em]">S_____________/_____________D</p>
      </div>

      <p className="mb-4">De mi mayor consideración:</p>
      <p className="mb-4 text-justify indent-8">
        Me dirijo a Ud. a fin de poner en su conocimiento los reclamos vinculados a{" "}
        <b>pérdidas de agua, tapas de registro y sumideros</b> registrados en los sistemas
        operativos de esta Dirección, cuya atención — conforme a su naturaleza — corresponde
        al organismo a su cargo. Se acompaña el detalle de cada caso con su ubicación
        georreferenciada y, de contarse con ella, la fotografía correspondiente, a efectos de
        facilitar su localización y tratamiento.
      </p>
      {observaciones && <p className="mb-4 text-justify indent-8">{observaciones}</p>}
      <p className="mb-6 text-justify indent-8">
        Los casos informados ascienden a <b>{renglones.length}</b>. Se solicita, de
        corresponder, tenga a bien informar a esta Dirección las resoluciones adoptadas,
        citando el número de ticket de cada reclamo, a fin de mantener actualizado el registro.
      </p>

      {/* Detalle */}
      <p className="mb-3 text-[13px] font-bold tracking-wider uppercase">
        Anexo — Detalle de los reclamos
      </p>
      <ol className="space-y-4">
        {renglones.map((r, i) => (
          <li
            key={r.demandaId}
            className="rounded-lg border border-borde p-3 print:rounded-none print:border-black"
            style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <b>
                {i + 1}. {r.tipo ? (ETIQUETA_TIPO_NOTA[r.tipo] ?? r.tipo) : "Reclamo"}
              </b>
              <span>{r.direccion ?? "sin dirección registrada"}</span>
              {r.barrio && <span>({r.barrio})</span>}
            </div>
            <p className="mt-0.5 text-[13px] text-texto-2 print:text-black">
              {r.ticket ? <>Ticket de Atención Ciudadana <b>{r.ticket}</b> · </> : null}
              {r.fechaPedido ? <>registrado el {r.fechaPedido} · </> : null}
              {r.lat != null && r.lon != null ? (
                <>
                  georreferencia{" "}
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.lat.toFixed(6)}, {r.lon.toFixed(6)}
                  </span>
                </>
              ) : (
                "sin georreferencia"
              )}
            </p>
            {r.fotoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- evidencia externa/Storage */
              <img
                src={r.fotoUrl}
                alt={`Fotografía del reclamo ${r.ticket ?? r.demandaId}`}
                loading="lazy"
                className="mt-2 max-h-56 rounded border border-borde object-cover print:border-black"
                style={{ breakInside: "avoid" }}
              />
            )}
          </li>
        ))}
      </ol>

      {/* Cierre y firma */}
      <p className="mt-8 mb-10 text-justify indent-8">
        Sin otro particular, saludo a Ud. con distinguida consideración.
      </p>
      <div className="mb-2 text-center">
        <div className="mx-auto w-64 border-t border-texto-3 pt-2 print:border-black">
          <p className="font-bold">Dirección de Bacheo</p>
          <p className="text-[13px]">Secretaría de Obras Públicas</p>
        </div>
      </div>

      <p className="mt-8 border-t border-borde pt-3 text-[11px] text-texto-3 print:border-black print:text-black">
        Documento generado por CIMBA — Centro Inteligente de Monitoreo de Baches y Asfalto
        {numero && <> · Registrado como <b>{numero}</b></>}
        {generadoPor && <> · por {generadoPor}</>}
        {" "}· {renglones.length} reclamo(s). Las coordenadas corresponden al sistema WGS84.
      </p>
    </div>
  );
}
