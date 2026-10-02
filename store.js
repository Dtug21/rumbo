// store.js — guarda y carga los datos en localStorage del navegador. Nada sale del dispositivo.
import { datosVacios, migrar, validarDatos } from './logic.js';

const CLAVE = 'rumbo.datos';
const CLAVE_COPIA = 'rumbo.copiaPrevia';
const CLAVE_DANADO = 'rumbo.danado';
const CLAVE_DIARIAS = 'rumbo.copiasDiarias';
const DIAS_DE_COPIAS = 7;

export const crearId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Devuelve { datos, aviso, nuevo }. Si lo guardado está dañado, lo aparta (no lo borra) y parte vacío. */
export function cargar(hoy) {
  let texto;
  try {
    texto = localStorage.getItem(CLAVE);
  } catch {
    return { datos: datosVacios(hoy), aviso: 'Este navegador no deja guardar datos (¿modo privado o almacenamiento bloqueado?). Puedes usar Rumbo, pero nada quedará guardado al cerrar.', nuevo: false };
  }
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
    try {
      localStorage.setItem(CLAVE_DANADO, texto);
    } catch {
      // sin espacio para apartarlo: igual se avisa
    }
    return {
      datos: datosVacios(hoy),
      aviso: `Los datos guardados estaban dañados (${err.message}). Quedaron apartados en "${CLAVE_DANADO}" y partí vacío. Si tienes un respaldo, impórtalo en Ajustes.`,
      nuevo: true,
    };
  }
}

/** Guarda y dice si pudo: el navegador puede negarse (almacenamiento lleno o bloqueado). */
export function guardar(datos) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    return true;
  } catch {
    return false;
  }
}

/** Copia automática antes de reemplazar los datos (al importar o al migrar de versión). */
export function guardarCopiaPrevia(datos, cuando) {
  try {
    localStorage.setItem(CLAVE_COPIA, JSON.stringify({ cuando, datos }));
  } catch {
    // sin espacio para la copia: el reemplazo sigue, y el aviso de guardado avisará si tampoco cabe lo nuevo
  }
}

/**
 * Pide al navegador que no borre estos datos por falta de espacio (almacenamiento persistente).
 * Algunos navegadores lo conceden solos; otros preguntan. Si no se puede, no pasa nada.
 */
export async function pedirPersistencia() {
  try {
    if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
    await navigator.storage.persist();
  } catch {
    // no disponible
  }
}

export function leerCopiaPrevia() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_COPIA));
  } catch {
    return null;
  }
}

/** Copias de los últimos días: una por día, tomada la primera vez que abres Rumbo ese día (= cómo quedó ayer). */
export function leerCopiasDiarias() {
  try {
    const l = JSON.parse(localStorage.getItem(CLAVE_DIARIAS));
    return Array.isArray(l) ? l.filter((c) => c && c.fecha && c.datos) : [];
  } catch {
    return [];
  }
}

export function guardarCopiaDiaria(datos, fecha) {
  let lista = leerCopiasDiarias();
  if (lista.some((c) => c.fecha === fecha)) return;
  lista = [{ fecha, datos }, ...lista].slice(0, DIAS_DE_COPIAS);
  // Si no cabe, se van descartando las más antiguas antes de rendirse.
  while (lista.length) {
    try {
      localStorage.setItem(CLAVE_DIARIAS, JSON.stringify(lista));
      return;
    } catch {
      lista = lista.slice(0, -1);
    }
  }
}
