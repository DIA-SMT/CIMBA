import { ETIQUETA_FUENTE, ETIQUETA_TIPO, fechaCorta } from "@/lib/formato";

/**
 * Reporte imprimible del estado actual del mapa: extracto visual + números
 * precisos + listado de los registros visibles. Se abre en una pestaña lista
 * para imprimir o guardar como PDF y mandar.
 */
export interface DatosReporte {
  imagen: string | null;
  consulta: string | null;
  filtros: string[];
  demandas: Array<Record<string, unknown>>;
  incidentes: Array<Record<string, unknown>>;
  generadoPor: string;
}

const MAX_FILAS = 150;

const esc = (v: unknown): string =>
  String(v ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const etiquetaTipo = (t: unknown) => ETIQUETA_TIPO[String(t) as keyof typeof ETIQUETA_TIPO] ?? (t ? String(t) : "—");
const etiquetaFuente = (f: unknown) => ETIQUETA_FUENTE[String(f) as keyof typeof ETIQUETA_FUENTE] ?? String(f ?? "—");
const n = (x: number) => x.toLocaleString("es-AR");

const ETIQUETA_BRECHA: Record<string, string> = {
  sin_atencion: "Sin atención",
  en_cola: "En cola",
  posible_resuelta: "Prob. resuelta",
  sin_dato: "—",
};

const ETIQUETA_ESTADO_INC: Record<string, string> = {
  detectado: "Detectado",
  priorizado: "Priorizado",
  programado: "Programado",
  en_ejecucion: "En ejecución",
  reparado: "Reparado",
  verificado: "Verificado",
  desestimado: "Desestimado",
};

function cuenta(filas: Array<Record<string, unknown>>, clave: string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const f of filas) {
    const v = String(f[clave] ?? "—");
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function construirReporteHtml(d: DatosReporte): string {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
  const hora = ahora.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  const dems = d.demandas;
  const incs = d.incidentes;
  const m2 = Math.round(incs.reduce((acc, f) => acc + (Number(f.m2) || 0), 0));
  const sinAtencion = dems.filter((f) => f.brecha === "sin_atencion").length;
  const resueltos = incs.filter((f) => f.macro === "resuelto").length;
  const enCurso = incs.filter((f) => f.macro === "en_curso" || f.macro === "abierto").length;

  const tarjeta = (valor: string, etiqueta: string, color: string) => `
    <div class="tarjeta"><div class="valor" style="color:${color}">${valor}</div><div class="etq">${etiqueta}</div></div>`;

  const seccionCuenta = (titulo: string, pares: Array<[string, number]>, etiquetar: (k: string) => string) =>
    pares.length === 0
      ? ""
      : `<div class="bloque"><h3>${titulo}</h3><table class="mini">${pares
          .slice(0, 8)
          .map(([k, v]) => `<tr><td>${esc(etiquetar(k))}</td><td class="num">${n(v)}</td></tr>`)
          .join("")}</table></div>`;

  const filasDem = dems
    .slice(0, MAX_FILAS)
    .map(
      (f) => `<tr>
        <td class="num">${esc(f.id)}</td>
        <td>${esc(etiquetaFuente(f.fuente))}</td>
        <td>${esc(etiquetaTipo(f.tipo))}</td>
        <td>${esc(f.direccion)}</td>
        <td>${esc(ETIQUETA_BRECHA[String(f.brecha)] ?? f.brecha)}</td>
        <td class="num">${f.sin_fecha ? "s/f" : esc(fechaCorta(String(f.creado_en)))}</td>
      </tr>`,
    )
    .join("");

  const filasInc = incs
    .slice(0, MAX_FILAS)
    .map(
      (f) => `<tr>
        <td class="num">${esc(f.id)}</td>
        <td>${esc(etiquetaTipo(f.tipo))}</td>
        <td>${esc(f.direccion)}</td>
        <td>${esc(ETIQUETA_ESTADO_INC[String(f.estado)] ?? f.estado)}</td>
        <td class="num">${f.score != null ? Number(f.score).toFixed(1) : "—"}</td>
        <td class="num">${f.m2 != null ? n(Math.round(Number(f.m2))) : "—"}</td>
        <td class="num">${esc(fechaCorta(String(f.detectado_en)))}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>CIMBA · Reporte del mapa · ${fecha}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Poppins, system-ui, sans-serif; color: #333333; background: #fff; font-size: 12px; line-height: 1.5; }
  .hoja { max-width: 860px; margin: 0 auto; padding: 28px 32px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid #0066FF; padding-bottom: 14px; }
  header h1 { font-size: 20px; font-weight: 800; color: #0066FF; letter-spacing: -0.02em; }
  header .sub { font-size: 11px; color: #667085; }
  header .meta { text-align: right; font-size: 11px; color: #667085; }
  .consulta { margin: 14px 0 4px; padding: 10px 14px; background: #f0f6ff; border-left: 4px solid #2EB1FF; border-radius: 6px; font-size: 13px; }
  .consulta b { color: #0066FF; }
  .filtros { margin: 8px 0 0; font-size: 11px; color: #667085; }
  .filtros span { display: inline-block; background: #f2f4f7; border-radius: 999px; padding: 2px 10px; margin: 2px 4px 2px 0; }
  .tarjetas { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
  .tarjeta { border: 1px solid #e4e7ec; border-radius: 10px; padding: 10px 12px; }
  .tarjeta .valor { font-size: 22px; font-weight: 800; }
  .tarjeta .etq { font-size: 10px; color: #667085; }
  .mapa { margin: 6px 0 2px; border: 1px solid #e4e7ec; border-radius: 10px; overflow: hidden; }
  .mapa img { display: block; width: 100%; }
  .atrib { font-size: 9px; color: #98a2b3; margin: 4px 0 14px; }
  .resumenes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 6px 0 14px; }
  .bloque h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #0066FF; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  table.mini td { padding: 2.5px 4px; border-bottom: 1px solid #f2f4f7; font-size: 11px; }
  h2 { font-size: 13px; font-weight: 700; margin: 18px 0 8px; color: #1d2939; border-bottom: 1px solid #e4e7ec; padding-bottom: 4px; }
  table.datos th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #667085; padding: 6px 6px; border-bottom: 2px solid #e4e7ec; }
  table.datos td { padding: 4.5px 6px; border-bottom: 1px solid #f2f4f7; font-size: 10.5px; vertical-align: top; }
  td.num, th.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nota { font-size: 10px; color: #98a2b3; margin-top: 4px; }
  footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e4e7ec; display: flex; justify-content: space-between; font-size: 10px; color: #98a2b3; }
  .barra { position: fixed; top: 12px; right: 12px; }
  .barra button { font-family: inherit; background: #0066FF; color: #fff; border: 0; border-radius: 10px; padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,102,255,.35); }
  @media print {
    .barra { display: none; }
    .hoja { padding: 0; max-width: none; }
    .tarjeta, .mapa, .consulta { break-inside: avoid; }
    table.datos tr { break-inside: avoid; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>
<div class="barra"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
<div class="hoja">
  <header>
    <div>
      <h1>CIMBA · Reporte del mapa</h1>
      <div class="sub">Centro Inteligente de Monitoreo de Baches y Asfalto — Municipalidad de San Miguel de Tucumán</div>
    </div>
    <div class="meta">${fecha} · ${hora} hs<br/>Generado por: ${esc(d.generadoPor)}</div>
  </header>

  ${d.consulta ? `<div class="consulta">Consulta: <b>“${esc(d.consulta)}”</b></div>` : ""}
  ${d.filtros.length > 0 ? `<div class="filtros">Filtros activos: ${d.filtros.map((f) => `<span>${esc(f)}</span>`).join("")}</div>` : ""}

  <div class="tarjetas">
    ${tarjeta(n(dems.length), "pedidos en el reporte", "#0066FF")}
    ${tarjeta(n(sinAtencion), "sin atención (brecha)", "#c2410c")}
    ${tarjeta(`${n(enCurso)} / ${n(resueltos)}`, "incidentes activos / resueltos", "#0e7a54")}
    ${tarjeta(`${n(m2)} m²`, "superficie intervenida", "#1d2939")}
  </div>

  ${
    d.imagen
      ? `<div class="mapa"><img src="${d.imagen}" alt="Extracto del mapa" /></div>
         <div class="atrib">Extracto cartográfico: © CARTO · © OpenStreetMap contributors — puntos y capas: CIMBA.</div>`
      : ""
  }

  <div class="resumenes">
    ${seccionCuenta("Por tipo de problema", cuenta([...dems, ...incs], "tipo"), etiquetaTipo)}
    ${seccionCuenta("Quién lo pide", cuenta(dems, "fuente"), etiquetaFuente)}
    ${seccionCuenta("Situación (brecha)", cuenta(dems, "brecha"), (k) => ETIQUETA_BRECHA[k] ?? k)}
  </div>

  ${
    dems.length > 0
      ? `<h2>Pedidos (${n(dems.length)})</h2>
  <table class="datos">
    <thead><tr><th class="num">#</th><th>Fuente</th><th>Tipo</th><th>Dirección</th><th>Situación</th><th class="num">Fecha</th></tr></thead>
    <tbody>${filasDem}</tbody>
  </table>
  ${dems.length > MAX_FILAS ? `<p class="nota">Se listan los primeros ${MAX_FILAS}; el reporte contabiliza los ${n(dems.length)}.</p>` : ""}`
      : ""
  }

  ${
    incs.length > 0
      ? `<h2>Incidentes y trabajos (${n(incs.length)})</h2>
  <table class="datos">
    <thead><tr><th class="num">#</th><th>Tipo</th><th>Dirección</th><th>Estado</th><th class="num">Score</th><th class="num">m²</th><th class="num">Detectado</th></tr></thead>
    <tbody>${filasInc}</tbody>
  </table>
  ${incs.length > MAX_FILAS ? `<p class="nota">Se listan los primeros ${MAX_FILAS}; el reporte contabiliza los ${n(incs.length)}.</p>` : ""}`
      : ""
  }

  <footer>
    <span>CIMBA — Dirección de Inteligencia Artificial · Municipalidad de San Miguel de Tucumán</span>
    <span>Los datos reflejan lo visible en el mapa al momento de generar el reporte.</span>
  </footer>
</div>
</body>
</html>`;
}

export function abrirReporte(d: DatosReporte): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(construirReporteHtml(d));
  w.document.close();
  return true;
}
