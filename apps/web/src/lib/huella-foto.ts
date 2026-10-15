import "server-only";
import { promises as fs } from "node:fs";
import { getDb, sql } from "@cimba/db";
import { ALTO_HUELLA, ANCHO_HUELLA, huellaDePixeles } from "@cimba/domain";
import { rutaLocalFoto } from "./almacen-fotos";

/**
 * LA HUELLA DE UNA FOTO, del lado del servidor (la cuenta está en
 * @cimba/domain, huella.ts, y es la misma que hace el teléfono).
 *
 * Nunca rompe una carga: ante cualquier problema la huella queda vacía y la
 * foto se guarda igual. Una carga sin alarma es mejor que una carga perdida.
 */

/** La huella de 64 bits como texto "0101…", listo para castear a bit(64). */
export async function huellaDeImagen(datos: ArrayBuffer | Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(Buffer.isBuffer(datos) ? datos : Buffer.from(datos))
      .rotate() // la orientación del EXIF, como la ve una persona
      .removeAlpha()
      .resize(ANCHO_HUELLA, ALTO_HUELLA, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== ANCHO_HUELLA || info.height !== ALTO_HUELLA) return null;
    return huellaDePixeles(data, info.channels);
  } catch {
    return null;
  }
}

/**
 * Completa la huella de las fotos de un trabajo que todavía no la tienen. Se
 * llama DESPUÉS de guardar la carga, en los caminos donde la foto ya estaba
 * guardada (la propuesta que se valida, el "ya estaba resuelto", la carga sin
 * orden): lee cada foto del disco del servidor y anota su huella. Si algo
 * falla, la foto queda sin huella y nada más: la carga ya está guardada.
 *
 * El trabajo se puede nombrar por la intervención, por el item de la orden o
 * por el problema: cada camino tiene a mano uno distinto.
 */
export async function completarHuellas(de: {
  intervenciones?: number[];
  items?: number[];
  incidentes?: number[];
}): Promise<void> {
  const lista = (v?: number[]) => {
    const ids = (v ?? []).filter((x) => Number.isInteger(x) && x > 0);
    return ids.length > 0 ? sql.join(ids.map((x) => sql`${x}`), sql`, `) : sql`null`;
  };
  try {
    const db = getDb();
    const fotos = (await db.execute(sql`
      select f.id, f.storage_path, f.url_externa from fotografias f
      where f.huella is null and f.storage_path is not null
        and f.intervencion_id in (
          select iv.id from intervenciones iv
          where iv.id in (${lista(de.intervenciones)})
             or iv.incidente_id in (${lista(de.incidentes)})
             or iv.id in (select oi.intervencion_id from orden_items oi where oi.id in (${lista(de.items)}))
        )
    `)) as unknown as Array<{ id: number; storage_path: string | null; url_externa: string | null }>;
    for (const f of fotos) {
      if (!f.storage_path) continue;
      let datos: Buffer;
      try {
        datos = await fs.readFile(rutaLocalFoto(f.storage_path));
      } catch {
        continue;
      }
      const huella = await huellaDeImagen(datos);
      if (!huella) continue;
      await db.execute(sql`update fotografias set huella = ${huella}::bit(64) where id = ${Number(f.id)}`);
    }
  } catch {
    /* sin huella, pero la carga está guardada */
  }
}
