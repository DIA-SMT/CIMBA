/**
 * CARGA LA PLANILLA DE BACHEO DE INGECO DE SEPTIEMBRE DE 2026 como trabajos
 * HECHOS, en dos órdenes nuevas (zona centro y zona sur).
 *
 * Lo definido con Leo y el usuario el 13/10/2026:
 *  - entran como hechos, con la fecha, el volumen y el remito de la planilla;
 *  - la empresa después ubica el bache (si hace falta) y sube las fotos desde
 *    su portal ("Falta completar" en cada orden, completarItemHecho);
 *  - para el acta cuentan recién con la foto del después (CERTIFICABLE).
 *
 * Reglas de la carga:
 *  - UBICACIÓN: solo los baches que el callejero municipal o el cruce de
 *    calles ubican a nivel "exacta" entran con lugar (y por lo tanto en el
 *    mapa, en Avance y en la brecha). El resto entra hecho pero SIN lugar, con
 *    el punto aproximado guardado como sugerencia para el pin
 *    (metadata.falta_ubicar): un pin a una cuadra de distancia pintaría la
 *    cuadra equivocada en Avance y cerraría pedidos de vecinos que no se
 *    taparon. Se ubican cuando Ingeco los completa.
 *  - MEDIDAS: la planilla trae volumen de mezcla, no superficie ni espesor. Se
 *    guarda espesor 5 cm (el estándar, migración 0032) y superficie =
 *    volumen / 0,05, marcada como estimación (medicion = 'volumen'). Las
 *    toneladas salen del volumen a 2,4 t/m³, como siempre. El volumen y las
 *    toneladas de la planilla quedan anotados tal cual en metadata.
 *  - REMITO: uno por día, compartido entre centro y sur (en la planilla figura
 *    en una sola fila de cada jornada). Va en el item y, la lista por día, en
 *    la orden. 25, 26, 28 y 29/09 no tienen remito en la planilla.
 *  - LAS ÓRDENES se insertan ya "en ejecución", sin vencimiento y con
 *    orden_abierta: no pasan por emitirOrden (no disparan el aviso de orden
 *    emitida), el cron de vencimientos no las nombra, y no se cierran solas.
 *    Avance no las dibuja como obra en curso (metadata.importada_de).
 *  - No crea nada en external_ref: la sincronización de la planilla de
 *    empresas (Apps Script) no puede pisar estos baches.
 *
 * NADA DE ESTO SE DESHACE CON GIT: escribe en la base de producción. Por eso:
 *
 *   node scripts/cargar-planilla-ingeco.mjs <filas.json>
 *       → MODO SECO (por defecto): muestra qué cargaría y no escribe nada.
 *   node scripts/cargar-planilla-ingeco.mjs <filas.json> --escribir --por <perfil_id>
 *       → escribe, en UNA transacción: o entra todo o no entra nada.
 *
 * <filas.json> es la planilla ya leída y geolocalizada (una fila por bache:
 * zona, filaExcel, fecha dd/mm, calle, altura, vol, tn, remitoEnFila, geo).
 * Es idempotente: si las órdenes de esta planilla ya existen, no hace nada.
 * Todo lo cargado lleva metadata.importado_de.planilla = 'ingeco_2026_09'
 * para encontrarlo y, si hiciera falta, darlo de baja con rastro.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const raiz = path.join(import.meta.dirname, "..");
for (const l of fs.readFileSync(path.join(raiz, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const PLANILLA = "ingeco_2026_09";
const ARCHIVO = "Bacheo de asfalto Septiembre 2026 1.xlsx";
const ANIO = 2026;
const ESPESOR_CM = 5;
const DENSIDAD = 2.4;
const TZ = "America/Argentina/Tucuman";
/** Zona de la planilla → zona de bacheo del contrato (zonas_bacheo.nombre). */
const ZONA = {
  centro: { zona: "Centro-Este", hoja: "zona centro", titulo: "INGECO - BACHEO ZONA CENTRO - SEPTIEMBRE 2026 (PLANILLA)" },
  sur: { zona: "SE", hoja: "Zona Sur", titulo: "INGECO - BACHEO ZONA SUR - SEPTIEMBRE 2026 (PLANILLA)" },
};

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const escribir = args.includes("--escribir");
const por = args[args.indexOf("--por") + 1];
if (!archivo || !fs.existsSync(archivo)) {
  console.error("Uso: node scripts/cargar-planilla-ingeco.mjs <filas.json> [--escribir --por <perfil_id>]");
  process.exit(1);
}
if (escribir && (!por || args.indexOf("--por") < 0)) {
  console.error("Para escribir hace falta --por <perfil_id>: queda como quien cargó, en la auditoría.");
  process.exit(1);
}

const filas = JSON.parse(fs.readFileSync(archivo, "utf8"));
const redondear = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const titulo = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Remito por día: aparece en una sola fila de la jornada y vale para toda ella.
const remitoDelDia = new Map();
for (const f of filas) if (f.remitoEnFila) remitoDelDia.set(f.fecha, String(f.remitoEnFila).trim());

const baches = filas.map((f) => {
  const [dd, mm] = String(f.fecha).split("/").map(Number);
  if (!dd || !mm) throw new Error(`Fecha ilegible en ${f.zona} fila ${f.filaExcel}: ${f.fecha}`);
  const fecha = `${ANIO}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const calle = titulo(f.calle);
  const altura = titulo(f.altura);
  const direccion = !calle ? null : /^\d+$/.test(altura) ? `${calle} ${altura}` : altura ? `${calle} y ${altura}` : calle;
  const vol = Number(f.vol) > 0 ? Number(f.vol) : null;
  const superficie = vol != null ? redondear(vol / (ESPESOR_CM / 100)) : null;
  // Lo mismo que calcula la base: orden_items.volumen_m3 = round(sup × esp / 100, 2).
  const volumenBase = superficie != null ? redondear((superficie * ESPESOR_CM) / 100) : null;
  const ubicado = f.geo?.nivel === "exacta";
  const remito = remitoDelDia.get(f.fecha) ?? null;
  return {
    zona: f.zona,
    fila: f.filaExcel,
    fecha,
    direccion,
    vol,
    tn: Number(f.tn) > 0 ? Number(f.tn) : null,
    superficie,
    volumenBase,
    tipoObra: superficie != null && superficie > 4 ? "extendido" : "planificado",
    ubicado,
    lat: ubicado ? f.geo.lat : null,
    lon: ubicado ? f.geo.lon : null,
    sugerido: !ubicado && f.geo ? { lat: f.geo.lat, lon: f.geo.lon, nivel: f.geo.nivel, via: f.geo.via } : null,
    remito,
  };
});

// ── Resumen (siempre) ───────────────────────────────────────────────────────
const n = (x) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(x);
const suma = (xs, k) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);
console.log(`Planilla: ${ARCHIVO} · ${baches.length} baches`);
for (const z of Object.keys(ZONA)) {
  const b = baches.filter((x) => x.zona === z);
  console.log(
    `  ${z.padEnd(6)} ${String(b.length).padStart(4)} baches · con lugar ${b.filter((x) => x.ubicado).length}` +
      ` · a ubicar ${b.filter((x) => !x.ubicado).length} (con punto sugerido ${b.filter((x) => x.sugerido).length})` +
      ` · ${n(suma(b, "superficie"))} m² · ${n(suma(b, "tn"))} t planilla / ${n(suma(b, "volumenBase") * DENSIDAD)} t calculadas`,
  );
}
const sinVolumen = baches.filter((x) => x.vol == null);
const sinDireccion = baches.filter((x) => !x.direccion);
console.log(`  sin volumen: ${sinVolumen.length} (${sinVolumen.map((x) => `${x.zona} fila ${x.fila}`).join(", ") || "—"})`);
console.log(`  sin dirección: ${sinDireccion.length} (${sinDireccion.map((x) => `${x.zona} fila ${x.fila}`).join(", ") || "—"})`);
const dias = [...new Set(baches.map((x) => x.fecha))].sort();
console.log(`  días: ${dias.length}, del ${dias[0]} al ${dias.at(-1)} · con remito ${dias.filter((d) => baches.find((x) => x.fecha === d)?.remito).length}`);

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

try {
  const [empresa] = await sql`select id, nombre from empresas where slug = 'ingeco' and activa`;
  if (!empresa) throw new Error("No encontré la empresa Ingeco (slug 'ingeco')");
  const zonas = await sql`select id, nombre from zonas_bacheo where nombre in ${sql(Object.values(ZONA).map((z) => z.zona))}`;
  const idZona = Object.fromEntries(zonas.map((z) => [z.nombre, Number(z.id)]));
  for (const z of Object.values(ZONA)) if (!idZona[z.zona]) throw new Error(`No encontré la zona de bacheo ${z.zona}`);

  const ya = await sql`select numero from ordenes_trabajo where metadata->'importada_de'->>'planilla' = ${PLANILLA}`;
  if (ya.length > 0) {
    console.log(`\nYa están cargadas: ${ya.map((o) => o.numero).join(", ")}. No hago nada.`);
    process.exit(0);
  }

  /* Qué pasa en la brecha: pedidos abiertos a 40 m de un bache que entra CON
     lugar, anteriores a la fecha del bache (o sin fecha). Esos pasan a "ya
     resuelta probable" en el semáforo. No escribe nada en los pedidos. */
  const conLugar = baches.filter((x) => x.ubicado);
  const puntos = conLugar.map((x) => [x.lon, x.lat, x.fecha]);
  const [brecha] = await sql`
    with p as (
      select st_setsrid(st_makepoint((v->>0)::float8, (v->>1)::float8), 4326) as geom,
             ((v->>2)::date + time '12:00') at time zone ${TZ} as cuando
      from jsonb_array_elements(${sql.json(puntos)}::jsonb) v
    )
    select count(distinct d.id)::int as pedidos
    from demandas d join p on st_dwithin(d.geom::geography, p.geom::geography, 40)
    where d.estado in ('recibida', 'en_validacion') and d.geom is not null
      and (d.metadata->>'sin_fecha' = 'true' or d.creado_en <= p.cuando)
      and not exists (
        select 1 from incidentes i
        where i.estado in ('reparado', 'verificado')
          and st_dwithin(i.geom::geography, d.geom::geography, 40)
          and (d.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= d.creado_en))
  `;
  console.log(`\nEn la brecha: ${brecha.pedidos} pedidos abiertos tienen a menos de 40 m un bache de la planilla que entra con lugar.`);
  console.log("Pasarían a 'ya resuelta probable' en el semáforo (no se cierra ningún pedido ni se avisa a nadie).");

  if (!escribir) {
    console.log("\nMODO SECO: no se escribió nada. Para cargar: --escribir --por <perfil_id>.");
    process.exit(0);
  }

  const [perfil] = await sql`select id, nombre, rol from perfiles where id = ${por} and activo`;
  if (!perfil) throw new Error(`No encontré un perfil activo con id ${por}`);

  const resultado = await sql.begin(async (tx) => {
    // El actor de la auditoría: quien autorizó la carga.
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: perfil.id, rol_cimba: perfil.rol })}, true)`;
    const enEsteMomento = new Date().toISOString();
    const ordenes = {};
    for (const [clave, z] of Object.entries(ZONA)) {
      const deLaZona = baches.filter((x) => x.zona === clave);
      const remitos = [...new Set(deLaZona.map((x) => x.fecha))].sort().map((fecha) => ({
        fecha,
        numero: deLaZona.find((x) => x.fecha === fecha)?.remito ?? null,
        tn_planilla: redondear(suma(deLaZona.filter((x) => x.fecha === fecha), "tn"), 3),
      }));
      const [o] = await tx`
        insert into ordenes_trabajo (numero, empresa_id, estado, prioridad, titulo, indicaciones, creada_por,
                                     emitida_en, vence_en, tipo, ambito, zona_id, contrato, metadata)
        values (
          siguiente_numero_orden(), ${empresa.id}, 'en_ejecucion', 'primaria', ${z.titulo},
          ${"Bacheo de septiembre cargado desde la planilla de Ingeco. Falta completar cada bache: subir la foto del después (y la del antes si la tienen) y ubicar los que no tienen lugar en el mapa. Para el acta cuentan recién con la foto."},
          ${perfil.id}, ${"2026-09-01T12:00:00-03:00"}, null, 'bacheo', 'zona', ${idZona[z.zona]},
          (select contrato from empresas where id = ${empresa.id}),
          ${tx.json({
            orden_abierta: true,
            importada_de: { planilla: PLANILLA, archivo: ARCHIVO, hoja: z.hoja, cargada_por: perfil.nombre, cargada_en: enEsteMomento },
            remitos,
          })}
        ) returning id, numero
      `;
      ordenes[clave] = { id: Number(o.id), numero: o.numero };
    }

    let conLugarN = 0;
    let aUbicarN = 0;
    for (const b of baches) {
      const orden = ordenes[b.zona];
      const cuando = `${b.fecha}T12:00:00-03:00`;
      const importado = { planilla: PLANILLA, archivo: ARCHIVO, hoja: ZONA[b.zona].hoja, fila: b.fila };
      const metadataItem = {
        medicion: "volumen",
        importado_de: importado,
        volumen_planilla_m3: b.vol,
        toneladas_planilla: b.tn,
        remito: b.remito ? { numero: b.remito, fecha: b.fecha } : null,
        ...(b.vol == null ? { sin_volumen: true } : {}),
        ...(b.ubicado ? {} : { falta_ubicar: b.sugerido ?? {} }),
      };
      if (!b.ubicado) {
        await tx`
          insert into orden_items (orden_id, direccion, tipo_trabajo, estado, espesor_cm, superficie_m2,
                                   tipo_obra, reportado_en, metadata)
          values (${orden.id}, ${b.direccion}, 'bache', 'hecho', ${ESPESOR_CM}, ${b.superficie},
                  ${b.tipoObra}::tipo_obra_bacheo, ${cuando}, ${tx.json(metadataItem)})
        `;
        aUbicarN++;
        continue;
      }
      await tx`
        with punto as (select st_setsrid(st_makepoint(${b.lon}, ${b.lat}), 4326) as g),
        inc as (
          insert into incidentes (tipo, estado, geom, direccion, superficie_m2, detectado_en, cerrado_en,
                                  circuito_id, barrio_id, metadata)
          select 'bache', 'reparado', g, ${b.direccion}, ${b.superficie}, ${cuando}::timestamptz, ${cuando}::timestamptz,
                 circuito_de(g), barrio_de(g),
                 ${tx.json({ origen: "planilla", orden: orden.numero, empresa: empresa.nombre, importado_de: importado })}
          from punto returning id
        ),
        iv as (
          insert into intervenciones (incidente_id, estado, geom_ejecucion, iniciada_en, finalizada_en,
                                      superficie_m2, volumen_m3, tipo_obra, tipo_intervencion, materiales, metadata)
          select inc.id, 'finalizada', punto.g, ${cuando}::timestamptz, ${cuando}::timestamptz,
                 ${b.superficie}, ${b.volumenBase}, ${b.tipoObra}::tipo_obra_bacheo, 'bacheo',
                 ${tx.json({ espesor_cm: ESPESOR_CM, medicion: "volumen", volumen_planilla_m3: b.vol })},
                 ${tx.json({
                   origen: "planilla",
                   orden: orden.numero,
                   contratista: empresa.nombre,
                   empresa: empresa.nombre,
                   escala: "bache",
                   medicion: "volumen",
                   remito: b.remito,
                   importado_de: importado,
                 })}
          from inc, punto returning id, incidente_id
        )
        insert into orden_items (orden_id, incidente_id, intervencion_id, direccion, geom, tipo_trabajo, estado,
                                 espesor_cm, superficie_m2, tipo_obra, reportado_en, metadata)
        select ${orden.id}, iv.incidente_id, iv.id, ${b.direccion}, punto.g, 'bache', 'hecho',
               ${ESPESOR_CM}, ${b.superficie}, ${b.tipoObra}::tipo_obra_bacheo, ${cuando}::timestamptz, ${tx.json(metadataItem)}
        from iv, punto
      `;
      conLugarN++;
    }
    return { ordenes, conLugarN, aUbicarN };
  });

  console.log(`\nCargado: ${Object.values(resultado.ordenes).map((o) => o.numero).join(" y ")}.`);
  console.log(`  ${resultado.conLugarN} baches con lugar (en el mapa) y ${resultado.aUbicarN} a ubicar por Ingeco.`);
  const control = await sql`
    select ot.numero, count(*)::int as items, count(oi.intervencion_id)::int as con_lugar,
           round(sum(oi.superficie_m2))::int as m2, round(sum(oi.volumen_m3) * 2.4, 1)::float as tn
    from orden_items oi join ordenes_trabajo ot on ot.id = oi.orden_id
    where ot.metadata->'importada_de'->>'planilla' = ${PLANILLA}
    group by ot.numero order by ot.numero
  `;
  console.table(control);
} finally {
  await sql.end();
}
