import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Dónde viven las fotos propias (las que suben las cuadrillas y el portal).
 * Antes era el bucket público "fotografias" de Supabase Storage; desde la
 * migración al servidor propio son archivos en disco que sirve nginx en
 * /fotos. Las fotos de otros sistemas (SIGOV, Drive) siguen con url_externa y
 * no pasan por acá.
 *
 * CIMBA_FOTOS_DIR es la carpeta raíz en el servidor; el storage_path guardado
 * en la base es la ruta relativa adentro de esa carpeta, idéntica a la que se
 * usaba como clave en el bucket. Así la migración no tocó una sola fila.
 */
const DIR = process.env.CIMBA_FOTOS_DIR ?? "/srv/cimba/fotos";

/**
 * La ruta en disco de una foto, blindada contra "..": el storage_path lo arma
 * siempre el propio código, pero igual se normaliza para que nada pueda
 * escribir ni leer fuera de la carpeta de fotos.
 */
export function rutaLocalFoto(storagePath: string): string {
  const limpio = path.posix.normalize(storagePath).replace(/^(\.\.(\/|$))+/, "");
  return path.join(DIR, limpio);
}

/**
 * Reemplaza a `supabase.storage.from("fotografias")` con la misma forma de
 * llamada y de respuesta ({ data, error }), para que los lugares que suben y
 * borran fotos no cambien su lógica: solo cambió de dónde sale el cliente.
 */
export function almacenFotos() {
  return {
    async upload(
      ruta: string,
      datos: Buffer | ArrayBuffer,
      opciones?: { contentType?: string; upsert?: boolean },
    ): Promise<{ data: { path: string } | null; error: { message: string } | null }> {
      try {
        const dest = rutaLocalFoto(ruta);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const buf = Buffer.isBuffer(datos) ? datos : Buffer.from(datos);
        // upsert:false era el modo de todos los llamadores; "wx" falla si el
        // archivo ya existe, igual que rechazaba el bucket.
        await fs.writeFile(dest, buf, { flag: opciones?.upsert ? "w" : "wx" });
        return { data: { path: ruta }, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : "no se pudo guardar la foto" } };
      }
    },
    async remove(rutas: string[]): Promise<{ data: unknown; error: null }> {
      await Promise.all(rutas.map((r) => fs.rm(rutaLocalFoto(r), { force: true }).catch(() => undefined)));
      return { data: null, error: null };
    },
  };
}

/** El cliente con la misma superficie que el de Supabase: `.storage.from(bucket)`. */
export function clienteFotos() {
  return { storage: { from: (_bucket: string) => almacenFotos() } };
}
