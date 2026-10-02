// traspaso.js — pasar tus datos de un equipo a otro como un texto corto que se copia y se pega.
// El texto es el respaldo comprimido (gzip) y escrito en base64 seguro para mensajes: «RUMBO1:…~» (la ~ marca el final, para poder pegar un mensaje entero).
// NO va cifrado: pégalo solo en un lugar privado tuyo (por ejemplo, «mensajes guardados»).
// Sin dependencias ni red: usa lo que ya trae el navegador (CompressionStream y btoa).

const PREFIJO = 'RUMBO1:';
const FIN = '~';
const MAX_BYTES = 5_000_000; // igual que el límite de un archivo de respaldo; protege de textos que se inflan al descomprimir

const aBase64Url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const deBase64Url = (texto) => {
  const b64 = texto.replaceAll('-', '+').replaceAll('_', '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** ¿Este navegador puede comprimir? (Chrome, Edge, Firefox y Safari recientes sí.) */
export const puedeTraspasar = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Texto → «RUMBO1:…». */
export async function codificar(texto) {
  if (!puedeTraspasar()) throw new Error('Este navegador no puede comprimir datos. Usa «Descargar respaldo».');
  const flujo = new Blob([new TextEncoder().encode(texto)]).stream().pipeThrough(new CompressionStream('gzip'));
  return PREFIJO + aBase64Url(new Uint8Array(await new Response(flujo).arrayBuffer())) + FIN;
}

/** Busca el código dentro de un mensaje cualquiera (aunque venga con saltos de línea, espacios o texto alrededor). */
export function extraerCodigo(texto) {
  const limpio = String(texto ?? '').replace(/[\s​]+/g, '');
  return limpio.match(/RUMBO1:[A-Za-z0-9_-]+~/)?.[0] ?? null;
}

/** «RUMBO1:…» → texto original. Lanza un Error con un mensaje claro si el código está incompleto o dañado. */
export async function decodificar(entrada) {
  const codigo = extraerCodigo(entrada);
  if (!codigo) {
    if (/RUMBO1:/.test(String(entrada ?? ''))) throw new Error('El código está incompleto: le falta el final (la ~). Cópialo de nuevo completo.');
    throw new Error('No encuentro un código de Rumbo en lo que pegaste. Debe empezar con «RUMBO1:».');
  }
  if (!puedeTraspasar()) throw new Error('Este navegador no puede descomprimir datos. Usa «Importar respaldo».');
  let bytes;
  try {
    bytes = deBase64Url(codigo.slice(PREFIJO.length, -FIN.length));
  } catch {
    throw new Error('El código está dañado. Cópialo de nuevo completo.');
  }
  try {
    const lector = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const partes = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) throw new RangeError('demasiado grande');
      partes.push(value);
    }
    const unido = new Uint8Array(total);
    let pos = 0;
    for (const p of partes) {
      unido.set(p, pos);
      pos += p.length;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(unido);
  } catch (e) {
    throw new Error(e instanceof RangeError ? 'El código es demasiado grande para ser un respaldo de Rumbo.' : 'El código está incompleto o dañado. Cópialo de nuevo completo.');
  }
}
