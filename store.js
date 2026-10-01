// store.js — guarda y carga los datos en localStorage del navegador. Nada sale del dispositivo.
import { datosVacios, migrar, validarDatos } from './logic.js';

const CLAVE = 'rumbo.datos';
const CLAVE_COPIA = 'rumbo.copiaPrevia';
const CLAVE_DANADO = 'rumbo.danado';

export const crearId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Devuelve { datos, aviso, nuevo }. Si lo guardado está dañado, lo aparta (no lo borra) y parte vacío. */
export function cargar(hoy) {
  const texto = localStorage.getItem(CLAVE);
  if (!texto) return { datos: datosVacios(hoy), aviso: null, nuevo: true };
  try {
    const obj = JSON.parse(texto);
    const datos = migrar(obj, hoy);
    const errores = validarDatos(datos);
    if (errores.length) throw new Error(errores.slice(0, 3).join('; '));
    // Antes de guardar datos migrados, se deja la versión anterior como copia previa.
    if (obj.version !== datos.version) guardarCopiaPrevia(obj, new Date().toISOString());
    return { datos, aviso: null, nuevo: obj.version !== datos.version };
  } catch (err) {
    localStorage.setItem(CLAVE_DANADO, texto);
    return {
      datos: datosVacios(hoy),
      aviso: `Los datos guardados estaban dañados (${err.message}). Quedaron apartados en "${CLAVE_DANADO}" y partí vacío. Si tienes un respaldo, impórtalo en Ajustes.`,
      nuevo: true,
    };
  }
}

export function guardar(datos) {
  localStorage.setItem(CLAVE, JSON.stringify(datos));
}

/** Copia automática antes de reemplazar los datos (al importar o al migrar de versión). */
export function guardarCopiaPrevia(datos, cuando) {
  localStorage.setItem(CLAVE_COPIA, JSON.stringify({ cuando, datos }));
}

export function leerCopiaPrevia() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_COPIA));
  } catch {
    return null;
  }
}
