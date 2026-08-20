import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { RolUsuario } from "@cimba/domain";
import * as schema from "./schema";

function crearDb(client: ReturnType<typeof postgres>) {
  return drizzle(client, { schema });
}

// Singleton en globalThis: en dev, el HMR de Next recarga este módulo y sin
// esto cada recompilación abriría un pool nuevo hasta saturar el pooler.
const globalDb = globalThis as unknown as {
  __cimbaDb?: ReturnType<typeof crearDb>;
};

export function getDb() {
  if (!globalDb.__cimbaDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no configurada");
    const client = postgres(url, {
      prepare: false, // requerido por el pooler de transacciones de Supabase
      max: Number(process.env.CIMBA_DB_POOL ?? 5),
      idle_timeout: 20,
      max_lifetime: 60 * 15,
    });
    globalDb.__cimbaDb = crearDb(client);
  }
  return globalDb.__cimbaDb;
}

export type Db = ReturnType<typeof getDb>;

export interface ClaimsCimba {
  sub: string; // perfil.id
  rol_cimba: RolUsuario;
  id_persona: number;
}

/**
 * Ejecuta `fn` dentro de una transacción con los claims del usuario inyectados
 * en `request.jwt.claims`, de modo que las políticas RLS (cimba_rol(),
 * cimba_perfil()) apliquen igual que con PostgREST.
 */
export async function conRls<T>(
  claims: ClaimsCimba,
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
    );
    return fn(tx);
  });
}

export { schema };
export { sql } from "drizzle-orm";
export type { SQL } from "drizzle-orm";
