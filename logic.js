// logic.js — lógica pura de Rumbo: fechas, progreso, recomendaciones, ideas con IA, validación y migración.
// Sin DOM ni almacenamiento: todo se prueba con `node --test`.

export const VERSION_DATOS = 4;
export const TIPOS_PROYECTO = ['principal', 'secundario'];
export const ESTADOS_PROYECTO = ['activo', 'pausado', 'terminado'];
export const TIPOS_OBJETIVO = ['resultado', 'tiempo'];
export const PERIODOS = ['semana', 'total'];
export const TAMANOS = Object.freeze({
  simple: { nombre: 'Simple', peso: 1, minutos: 20, detalle: 'hasta 30 min, sin pasos' },
  media: { nombre: 'Media', peso: 3, minutos: 60, detalle: '30 min a 2 h, 2 a 5 pasos' },
  amplia: { nombre: 'Amplia', peso: 8, minutos: 240, detalle: 'más de 2 h, en varias sesiones' },
});
export const MARGEN_CAPACIDAD = 0.7;
export const SESION_MAX = 60;
export const SESION_MAX_MEDIA = 120;
export const SESION_MIN = 15;
export const MINUTOS_PLANIFICAR = 10;
export const MAX_RECOMENDACIONES = 3;
export const MAX_POR_OBJETIVO = 2;
// Dentro de un objetivo, cuántas tareas pendientes (en su orden) pueden recomendarse a la vez.
export const TAREAS_EN_ORDEN = 2;
export const DIAS_PARA_BIENVENIDA = 3;
export const CERCA_DE_LA_META = 0.75;
// Un ritmo semanal atrasado suma hasta 40 puntos a comienzos de semana y hasta 70 en los últimos 3 días.
export const PUNTOS_ATRASO_RITMO = 70;
export const PUNTOS_ATRASO_INICIO = 40;
// El primer paso que elegiste ayer sube lo suficiente para ir primero, salvo ante un plazo vencido.
export const PUNTOS_ARRANQUE = 5;
const PUNTOS_PRIMER_PASO = 45;
export const DIAS_SECUNDARIO_OLVIDADO = 7;
// Una tarea sin pasos avanza según el tiempo trabajado, pero nunca pasa de 90% hasta que la terminas.
export const TOPE_POR_TIEMPO = 0.9;
export const DIAS_RECORDAR_RESPALDO = 7;
// Índice = getUTCDay(): 0 domingo … 6 sábado.
export const PLANTILLA_POR_DEFECTO = Object.freeze([180, 120, 120, 120, 120, 120, 180]);
// Pasos genéricos para partir una tarea grande cuando no sabes por dónde empezar.
export const PASOS_BASE = Object.freeze([
  'Definir qué significa "terminada"',
  'Juntar lo necesario',
  'Hacer una primera versión',
  'Revisar y ajustar',
  'Cerrar y entregar',
]);

const LIMITES = {
  proyectos: 200, objetivos: 1000, tareas: 5000, pasos: 50, registros: 50000, notas: 20000,
  texto: 300, criterio: 500, nota: 2000, descripcion: 5000, minutos: 1440, metaMinutos: 100000, etapa: 100, bandeja: 500, momento: 120, nombreTurno: 30, esperando: 120, unidad: 30, cantidad: 10000, indicador: 40, eventos: 3000, porQue: 300,
};
// Al crear tareas desde una lista (una por línea) parten como medias de 1 h; se ajustan después.
export const TAREA_RAPIDA = Object.freeze({ tamano: 'media', minutos: 60 });

// ---------- Fechas (texto local YYYY-MM-DD; la aritmética va en UTC para no depender del horario de verano) ----------

const DIA_MS = 86400000;
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const dos = (n) => String(n).padStart(2, '0');

export function esFechaValida(s) {
  if (typeof s !== 'string') return false;
  const m = RE_FECHA.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Fecha del calendario local del dispositivo (en Chile: la hora de Chile, con o sin horario de verano). */
export function hoyLocal(ahora = new Date()) {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

function aMs(fecha) {
  if (!esFechaValida(fecha)) throw new Error(`Fecha inválida: ${fecha}`);
  const m = RE_FECHA.exec(fecha);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function deMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

export const sumarDias = (fecha, n) => deMs(aMs(fecha) + n * DIA_MS);
export const diasEntre = (desde, hasta) => Math.round((aMs(hasta) - aMs(desde)) / DIA_MS);
export const diaSemana = (fecha) => new Date(aMs(fecha)).getUTCDay();
/** Días transcurridos de la semana antes de hoy: lunes 0 … domingo 6. */
export const indiceEnSemana = (fecha) => (diaSemana(fecha) + 6) % 7;
export const inicioSemana = (fecha) => sumarDias(fecha, -indiceEnSemana(fecha));

// ---------- Formato ----------

export function formatoDuracion(m) {
  m = Math.round(m);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

export const porcentaje = (x) => `${Math.round(x * 100)}%`;

// ---------- Índices ----------

const indexar = (lista) => new Map(lista.map((x) => [x.id, x]));

export function objetivosDe(datos, proyectoId) {
  return datos.objetivos.filter((o) => o.proyectoId === proyectoId);
}

/** Objetivos en curso del proyecto (las etapas ya ampliadas quedan guardadas dentro de su siguiente etapa). */
export function objetivosVisibles(datos, proyectoId) {
  return datos.objetivos.filter((o) => o.proyectoId === proyectoId && !o.archivado);
}

export function tareasDe(datos, objetivoId) {
  return datos.tareas.filter((t) => t.objetivoId === objetivoId);
}

/** Etapas anteriores de un objetivo, de la más reciente a la primera. */
export function etapasAnteriores(datos, o) {
  const porId = indexar(datos.objetivos);
  const etapas = [];
  const vistos = new Set([o.id]);
  let actual = o.anteriorId ? porId.get(o.anteriorId) : null;
  while (actual && !vistos.has(actual.id)) {
    etapas.push(actual);
    vistos.add(actual.id);
    actual = actual.anteriorId ? porId.get(actual.anteriorId) : null;
  }
  return etapas;
}

// ---------- Notas ----------

const porFecha = (a, b) => b.fecha.localeCompare(a.fecha);
export const notasDeTarea = (datos, tareaId) => datos.notas.filter((n) => n.tareaId === tareaId).sort(porFecha);
/** Notas del objetivo en sí (no las de sus tareas). */
export const notasDeObjetivo = (datos, objetivoId) => datos.notas.filter((n) => n.objetivoId === objetivoId && !n.tareaId).sort(porFecha);
/** Notas marcadas "falta algo" que siguen sin resolver. */
export const faltantesDeTarea = (datos, tareaId) => notasDeTarea(datos, tareaId).filter((n) => n.falta);
/** Todo lo que quedó "falta algo" en un objetivo: en él o en cualquiera de sus tareas. */
export const faltantesDeObjetivo = (datos, objetivoId) => datos.notas.filter((n) => n.objetivoId === objetivoId && n.falta).sort(porFecha);

/** Mueve una tarea a otro objetivo, llevándose sus notas. Modifica `d`. */
export function moverTarea(d, tareaId, objetivoId) {
  const t = d.tareas.find((x) => x.id === tareaId);
  t.objetivoId = objetivoId;
  for (const n of d.notas) if (n.tareaId === tareaId) n.objetivoId = objetivoId;
}

// ---------- Progreso ----------

export const minutosTrabajados = (datos, tareaId) =>
  datos.registros.filter((r) => r.tareaId === tareaId).reduce((s, r) => s + r.minutos, 0);

/** Media o amplia sin pasos: su barra se mueve con el tiempo trabajado. */
export const avanzaPorTiempo = (t) => !t.hecha && !t.pasos.length && t.tamano !== 'simple';

/**
 * Progreso de una tarea (0 a 1): terminada = 1; con pasos = pasos hechos / total;
 * media o amplia sin pasos = minutos trabajados / estimados, con tope de 90%; simple sin terminar = 0.
 * Sin `datos` no se conoce el tiempo trabajado y solo cuentan los pasos.
 */
export function progresoTarea(t, datos = null) {
  if (t.hecha) return 1;
  if (t.pasos.length) return t.pasos.filter((p) => p.hecho).length / t.pasos.length;
  if (!datos || t.tamano === 'simple') return 0;
  return Math.min(TOPE_POR_TIEMPO, minutosTrabajados(datos, t.id) / t.minutos);
}

/** Ya trabajaste lo estimado (o más) y la tarea sigue abierta: toca terminarla o ajustar la estimación. */
export const excedida = (t, datos) => !t.hecha && minutosTrabajados(datos, t.id) >= t.minutos;

/** Los objetivos de tiempo semanales se reinician cada lunes: se muestran como ritmo y no suman al avance del proyecto. */
export const esRitmoSemanal = (o) => o.tipo === 'tiempo' && o.periodo === 'semana';

/**
 * Objetivo de tiempo que se mide en unidades (postulaciones, propuestas, llamadas…) en vez de horas:
 * `unidad` (en plural), `metaCantidad` por periodo y `minutosPorUnidad` (lo que suele tomar cada una, para planificar).
 * Cada registro guarda cuántas hiciste (`cantidad`) y los minutos que tomó.
 */
export const esConteo = (o) => o.tipo === 'tiempo' && typeof o.unidad === 'string' && o.unidad !== '';
export const unidadSingular = (u) => (/iones$/i.test(u) ? u.replace(/iones$/i, 'ión') : u.replace(/s$/i, ''));
export const textoCantidad = (o, n) => `${n} ${n === 1 ? unidadSingular(o.unidad) : o.unidad}`;

/** Cantidad registrada para un objetivo por conteo: en la semana actual (lunes a domingo) o en total. */
export function cantidadRegistrada(datos, objetivoId, periodo, hoy) {
  const desde = periodo === 'semana' ? inicioSemana(hoy) : null;
  const hasta = periodo === 'semana' ? sumarDias(desde, 6) : null;
  return datos.registros
    .filter((r) => r.objetivoId === objetivoId && (!desde || (r.fecha >= desde && r.fecha <= hasta)))
    .reduce((s, r) => s + (r.cantidad ?? 0), 0);
}
export const cantidadHoy = (datos, hoy, objetivoId) =>
  datos.registros.filter((r) => r.fecha === hoy && r.objetivoId === objetivoId).reduce((s, r) => s + (r.cantidad ?? 0), 0);

/** Unidades sugeridas hoy para un objetivo por conteo (0 si ya va al día): reparte lo que falta en los días que quedan. */
export function unidadesSugeridas(o, datos, hoy) {
  const falta = o.metaCantidad - cantidadRegistrada(datos, o.id, o.periodo, hoy);
  if (falta <= 0) return 0;
  let ritmo;
  if (o.periodo === 'semana') ritmo = falta / (7 - indiceEnSemana(hoy));
  else if (o.plazo) ritmo = falta / Math.max(1, diasEntre(hoy, o.plazo) + 1);
  else ritmo = 1;
  const sugerido = Math.min(falta, Math.max(1, Math.ceil(ritmo)), 8);
  return Math.max(0, sugerido - cantidadHoy(datos, hoy, o.id));
}

/** Minutos registrados para un objetivo: en la semana actual (lunes a domingo) o en total. */
export function minutosRegistrados(datos, objetivoId, periodo, hoy) {
  const desde = periodo === 'semana' ? inicioSemana(hoy) : null;
  const hasta = periodo === 'semana' ? sumarDias(desde, 6) : null;
  return datos.registros
    .filter((r) => r.objetivoId === objetivoId && (!desde || (r.fecha >= desde && r.fecha <= hasta)))
    .reduce((s, r) => s + r.minutos, 0);
}

export const minutosHoy = (datos, hoy, objetivoId = null) =>
  datos.registros.filter((r) => r.fecha === hoy && (!objetivoId || r.objetivoId === objetivoId)).reduce((s, r) => s + r.minutos, 0);

/**
 * Progreso de un objetivo (0 a 1).
 * Resultado: tareas terminadas ponderadas por tamaño (simple 1, media 3, amplia 8), contando los pasos hechos.
 * Tiempo: minutos registrados en el periodo / meta.
 */
export function progresoObjetivo(o, datos, hoy) {
  if (o.tipo === 'tiempo') {
    const minutos = minutosRegistrados(datos, o.id, o.periodo, hoy);
    if (esConteo(o)) {
      const cantidad = cantidadRegistrada(datos, o.id, o.periodo, hoy);
      return { valor: Math.min(1, cantidad / o.metaCantidad), minutos, meta: o.minutosMeta, cantidad, metaCantidad: o.metaCantidad };
    }
    return { valor: Math.min(1, minutos / o.minutosMeta), minutos, meta: o.minutosMeta };
  }
  const tareas = tareasDe(datos, o.id);
  const hechas = tareas.filter((t) => t.hecha).length;
  if (o.logrado) return { valor: 1, hechas, total: tareas.length };
  const pesoTotal = tareas.reduce((s, t) => s + TAMANOS[t.tamano].peso, 0);
  const valor = pesoTotal ? tareas.reduce((s, t) => s + TAMANOS[t.tamano].peso * progresoTarea(t, datos), 0) / pesoTotal : 0;
  return { valor, hechas, total: tareas.length };
}

// ---------- Indicadores de resultado ----------

/**
 * Un objetivo puede seguir sus RESULTADOS además de su actividad: contadores que cada persona define
 * («Respuestas», «Entrevistas», «Ventas», «Personas que lo vieron»…) y que anota con +1.
 * Guardados en el propio objetivo: `indicadores: [{ id, nombre, eventos: [{ fecha, cantidad }] }]`.
 */
export const MAX_INDICADORES = 8;

export const nuevoIndicador = (id, nombre) => ({ id, nombre: String(nombre).trim().slice(0, LIMITES.indicador), eventos: [] });

const sumaEventos = (ind, desde, hasta) => (ind.eventos ?? []).filter((e) => (!desde || e.fecha >= desde) && (!hasta || e.fecha <= hasta)).reduce((s, e) => s + e.cantidad, 0);

/**
 * Cada indicador de un objetivo con su total, los últimos 7 días, los 7 anteriores y, si el objetivo se mide
 * en unidades, el porcentaje que representa («3 respuestas = 25% de tus postulaciones»).
 */
export function resumenIndicadores(o, datos, hoy) {
  const desde = sumarDias(hoy, -6);
  const previoDesde = sumarDias(desde, -7);
  const base = esConteo(o) ? cantidadRegistrada(datos, o.id, 'total', hoy) : 0;
  return (o.indicadores ?? []).map((ind) => {
    const total = sumaEventos(ind);
    return {
      indicador: ind,
      total,
      semana: sumaEventos(ind, desde, hoy),
      previa: sumaEventos(ind, previoDesde, sumarDias(desde, -1)),
      porcentajeDe: base > 0 ? Math.round((total / base) * 100) : null,
      base: base > 0 ? base : null,
    };
  });
}

/** Anota resultados (por defecto, 1) en un indicador, hoy o en otra fecha. Devuelve el indicador, o null si no existe. */
export function anotarResultado(d, objetivoId, indicadorId, fecha, cantidad = 1) {
  const ind = d.objetivos.find((o) => o.id === objetivoId)?.indicadores?.find((x) => x.id === indicadorId);
  if (!ind) return null;
  const previo = ind.eventos.find((e) => e.fecha === fecha);
  if (previo) previo.cantidad += cantidad;
  else ind.eventos.push({ fecha, cantidad });
  return ind;
}

/** Nombres escritos en una línea («Respuestas, Entrevistas») → indicadores nuevos, sin repetidos ni vacíos. */
export function indicadoresDesdeTexto(texto, crearId) {
  const vistos = new Set();
  const lista = [];
  for (const parte of String(texto ?? '').split(/[,\n;]/)) {
    const nombre = parte.trim().slice(0, LIMITES.indicador);
    const clave = nombre.toLowerCase();
    if (!nombre || vistos.has(clave) || lista.length >= MAX_INDICADORES) continue;
    vistos.add(clave);
    lista.push(nuevoIndicador(crearId(), nombre));
  }
  return lista;
}

/**
 * Cuánto avanzó una tarea (0 a 1) entre `desde` y hoy, con las fechas que guarda Rumbo:
 * pasos marcados (`hechoEl`), el cierre de la tarea (`hechaEl`) y, sin pasos, el tiempo registrado.
 */
export function avanceDeTareaEnVentana(t, datos, desde) {
  const n = t.pasos.length;
  const cierra = t.hecha && t.hechaEl && t.hechaEl >= desde;
  if (!n) {
    if (cierra) return 1;
    if (t.hecha) return 0;
    const minutos = datos.registros.filter((r) => r.tareaId === t.id && r.fecha >= desde).reduce((s, r) => s + r.minutos, 0);
    return Math.min(TOPE_POR_TIEMPO, minutos / t.minutos);
  }
  let avance = t.pasos.filter((p) => p.hecho && p.hechoEl && p.hechoEl >= desde).length / n;
  // Al cerrarla, lo que quedaba (pasos sin marcar o sin fecha, de respaldos antiguos) cuenta en ese día.
  if (cierra) avance += t.pasos.filter((p) => !p.hechoEl).length / n;
  return Math.min(1, avance);
}

/**
 * ¿Llegas al plazo de un objetivo de resultado al ritmo de los últimos 7 días?
 * Compara lo que falta (en % del objetivo) con lo que avanzaste esta última semana.
 * Devuelve null si no aplica (sin plazo, logrado, de tiempo o archivado).
 * estado: 'vencido' | 'en-ritmo' | 'en-riesgo' | 'sin-ritmo' (aún no hay semana de datos para opinar).
 */
export function riesgoPlazo(o, datos, hoy) {
  if (o.tipo !== 'resultado' || o.logrado || o.archivado || !o.plazo) return null;
  const tareas = tareasDe(datos, o.id);
  if (!tareas.length) return null;
  const dias = diasEntre(hoy, o.plazo);
  const falta = 1 - progresoObjetivo(o, datos, hoy).valor;
  if (falta <= 0.0001) return null;
  if (dias < 0) return { estado: 'vencido', dias, falta, necesario: null, lleva: 0 };
  const desde = sumarDias(hoy, -6);
  const pesoTotal = tareas.reduce((s, t) => s + TAMANOS[t.tamano].peso, 0);
  const lleva = pesoTotal ? tareas.reduce((s, t) => s + TAMANOS[t.tamano].peso * avanceDeTareaEnVentana(t, datos, desde), 0) / pesoTotal : 0;
  const necesario = (falta / Math.max(1, dias)) * 7; // por semana
  let estado;
  if (lleva >= necesario * 0.9) estado = 'en-ritmo';
  // Recién creado: aún no se puede opinar (con un plazo lejano, se espera una semana).
  else if (lleva === 0 && diasEntre(o.creado, hoy) < (dias >= 14 ? 7 : 3)) estado = 'sin-ritmo';
  else estado = 'en-riesgo';
  return { estado, dias, falta, necesario, lleva };
}

/**
 * Progreso del proyecto = promedio de sus objetivos (cada uno pesa lo mismo), sin los ritmos semanales.
 * Devuelve null si el proyecto solo tiene ritmos semanales (no hay avance acumulable que mostrar).
 */
export function progresoProyecto(p, datos, hoy) {
  const objetivos = objetivosDe(datos, p.id);
  const cuentan = objetivos.filter((o) => !esRitmoSemanal(o));
  if (!cuentan.length) return objetivos.length ? null : 0;
  return cuentan.reduce((s, o) => s + progresoObjetivo(o, datos, hoy).valor, 0) / cuentan.length;
}

/** Última fecha con avance en el proyecto (tiempo, pasos/tareas marcados o notas); si no hay, su creación. */
export function ultimoAvance(p, datos) {
  const ids = new Set(objetivosDe(datos, p.id).map((o) => o.id));
  let ultima = p.creado;
  for (const r of datos.registros) if (ids.has(r.objetivoId) && r.fecha > ultima) ultima = r.fecha;
  for (const t of datos.tareas) if (ids.has(t.objetivoId) && t.tocado && t.tocado > ultima) ultima = t.tocado;
  for (const n of datos.notas) if (ids.has(n.objetivoId) && n.fecha > ultima) ultima = n.fecha;
  return ultima;
}

export function resumenProyecto(p, datos, hoy) {
  const objetivos = objetivosDe(datos, p.id);
  const visibles = objetivos.filter((o) => !o.archivado);
  const ids = new Set(visibles.map((o) => o.id));
  const tareas = datos.tareas.filter((t) => ids.has(t.objetivoId));
  return {
    progreso: progresoProyecto(p, datos, hoy),
    ritmos: visibles.filter(esRitmoSemanal).map((o) => ({ objetivo: o, ...progresoObjetivo(o, datos, hoy) })),
    objetivos: visibles.length,
    etapasLogradas: objetivos.filter((o) => o.archivado).length,
    tareasPendientes: tareas.filter((t) => !t.hecha).length,
    tareasHechas: tareas.filter((t) => t.hecha).length,
    diasSinAvance: diasEntre(ultimoAvance(p, datos), hoy),
  };
}

/** Orden de la pantalla Proyectos: principales primero; dentro de cada grupo, el que lleva más días sin avance arriba. */
export function ordenarProyectos(datos, hoy) {
  const grupo = (p) => (p.estado !== 'activo' ? 2 : p.tipo === 'principal' ? 0 : 1);
  return [...datos.proyectos].sort(
    (a, b) => grupo(a) - grupo(b) || diasEntre(ultimoAvance(b, datos), ultimoAvance(a, datos)) || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

// ---------- Capacidad del día ----------

/**
 * Ciclos de turnos de ejemplo para partir (los minutos libres son un punto de partida: cada persona los ajusta).
 * Sirven para cualquier trabajo por turnos, no solo el de salud.
 */
export const CICLOS_EJEMPLO = Object.freeze([
  { id: 'cuarto', nombre: '4º turno (largo, noche, saliente, libre)', nombres: ['Largo', 'Noche', 'Saliente', 'Libre'], minutos: [30, 60, 45, 240] },
  { id: 'dos-dos', nombre: '2 y 2 (dos de turno, dos libres)', nombres: ['Turno', 'Turno', 'Libre', 'Libre'], minutos: [45, 45, 240, 240] },
  { id: 'semana', nombre: 'Empezar en blanco (7 días)', nombres: ['', '', '', '', '', '', ''], minutos: [120, 120, 120, 120, 120, 120, 120] },
]);
export const CICLO_CUARTO_TURNO = CICLOS_EJEMPLO[0];
export const CICLO_MIN = 2;
export const CICLO_MAX = 14;

/** Día del ciclo de turnos para una fecha (índice desde 0), o null si no hay ciclo. */
export function diaDelCiclo(disponibilidad, fecha) {
  const c = disponibilidad.ciclo;
  if (!c) return null;
  if (c.desde && fecha < c.desde) return null; // el ciclo rige desde esa fecha; antes, tu semana fija
  const k = c.minutos.length;
  const i = (((diasEntre(c.inicio, fecha) % k) + k) % k);
  return { indice: i, numero: i + 1, total: k, nombre: c.nombres[i] ?? '', minutos: c.minutos[i] };
}

/** Minutos libres de tu semana normal o de tu ciclo de turnos (sin contar los días especiales). */
export function minutosBase(disponibilidad, fecha) {
  const ciclo = diaDelCiclo(disponibilidad, fecha);
  if (ciclo) return ciclo.minutos;
  return disponibilidad.plantilla[diaSemana(fecha)] ?? 0;
}

export function minutosLibres(disponibilidad, fecha) {
  const excepcion = disponibilidad.excepciones?.[fecha];
  if (excepcion !== undefined && excepcion !== null) return excepcion;
  return minutosBase(disponibilidad, fecha);
}

/** Capacidad = minutos libres × 0,7: margen por la falacia de planificación. */
export const capacidadDia = (disponibilidad, fecha) => Math.floor(minutosLibres(disponibilidad, fecha) * MARGEN_CAPACIDAD);

// ---------- Plan de hoy ----------

/**
 * El plan de un día. Cada día tiene el suyo y queda guardado (historial); un día nuevo parte vacío
 * y lo pendiente vuelve a recomendarse.
 */
export function planDeHoy(datos, fecha) {
  return datos.planes[fecha] ?? { items: [], descartadas: [] };
}

/** Une cada ítem del plan con su tarea, objetivo y proyecto (descarta los que apuntan a algo borrado). */
function resolverItems(datos, plan) {
  const tareas = indexar(datos.tareas);
  const objetivos = indexar(datos.objetivos);
  const proyectos = indexar(datos.proyectos);
  return plan.items
    .map((i) => {
      const tarea = i.tareaId ? tareas.get(i.tareaId) : null;
      const objetivo = objetivos.get(i.objetivoId);
      const proyecto = objetivo && proyectos.get(objetivo.proyectoId);
      return objetivo && proyecto && (i.tipo !== 'tarea' || tarea) ? { ...i, tarea, objetivo, proyecto } : null;
    })
    .filter(Boolean);
}

/** Resumen de un día cualquiera (para el historial): plan, minutos, tareas terminadas y notas de ese día. */
export function vistaDia(datos, fecha) {
  const objetivos = indexar(datos.objetivos);
  const proyectos = indexar(datos.proyectos);
  const donde = (objetivoId) => {
    const o = objetivos.get(objetivoId);
    return o ? { objetivo: o, proyecto: proyectos.get(o.proyectoId) } : null;
  };
  return {
    items: resolverItems(datos, planDeHoy(datos, fecha)),
    minutos: minutosHoy(datos, fecha),
    terminadas: datos.tareas.filter((t) => t.hechaEl === fecha).map((t) => ({ tarea: t, ...donde(t.objetivoId) })),
    notas: datos.notas.filter((n) => n.fecha === fecha).map((n) => ({ nota: n, tarea: n.tareaId ? datos.tareas.find((t) => t.id === n.tareaId) : null, ...donde(n.objetivoId) })),
  };
}

/**
 * Minutos de la próxima sesión en una tarea: simple entera; media hasta 2 h y amplia hasta 1 h,
 * según lo que falta (por pasos, o por tiempo trabajado si no tiene pasos).
 */
export function minutosSesion(t, datos) {
  if (t.tamano === 'simple') return t.minutos;
  const restante = t.pasos.length ? t.minutos * (1 - progresoTarea(t)) : t.minutos - minutosTrabajados(datos, t.id);
  const tope = t.tamano === 'amplia' ? SESION_MAX : SESION_MAX_MEDIA;
  return Math.max(SESION_MIN, Math.min(tope, Math.round(restante / 5) * 5));
}

const redondear5 = (m) => Math.max(5, Math.round(m / 5) * 5);

/** Minutos sugeridos hoy para un objetivo de tiempo, o 0 si ya va al día. */
export function minutosSugeridosTiempo(o, datos, hoy) {
  const hecho = minutosRegistrados(datos, o.id, o.periodo, hoy);
  const falta = o.minutosMeta - hecho;
  if (falta <= 0) return 0;
  let ritmo;
  if (o.periodo === 'semana') ritmo = falta / (7 - indiceEnSemana(hoy));
  else if (o.plazo) ritmo = falta / Math.max(1, diasEntre(hoy, o.plazo) + 1);
  else ritmo = 30;
  const sugerido = Math.min(falta, Math.max(SESION_MIN, redondear5(ritmo)), 90);
  return Math.max(0, sugerido - minutosHoy(datos, hoy, o.id));
}

function motivoPlazo(plazo, hoy) {
  if (!plazo) return null;
  const d = diasEntre(hoy, plazo);
  if (d < 0) return { puntos: 100, texto: `El plazo venció hace ${d === -1 ? '1 día' : `${-d} días`}` };
  if (d === 0) return { puntos: 80, texto: 'Vence hoy' };
  if (d <= 2) return { puntos: 70, texto: `Vence en ${d === 1 ? '1 día' : `${d} días`}` };
  if (d <= 7) return { puntos: 55, texto: `Vence en ${d} días` };
  return null;
}

const claveItem = (i) => (i.tipo === 'tarea' ? `t:${i.tareaId}` : i.tipo === 'tiempo' ? `o:${i.objetivoId}` : `p:${i.objetivoId}`);

/**
 * Todas las cosas que podrías hacer hoy, con puntaje y motivos, de mayor a menor puntaje.
 * Reglas: plazos cercanos o vencidos, objetivos de tiempo atrasados en la semana, proyecto principal,
 * días sin avanzar en el proyecto, días sin tocar la tarea (para que ninguna quede olvidada),
 * tarea ya empezada, y objetivos sin tareas pendientes (hay que planificarlos).
 */
export function candidatos(datos, hoy) {
  const proyectos = indexar(datos.proyectos);
  const plan = planDeHoy(datos, hoy);
  const fuera = new Set([...plan.items.map(claveItem), ...plan.descartadas]);
  const foco = focoDeLaSemana(datos, hoy);
  const factorTareas = factorEstimacion(datos);
  const lista = [];

  // Puntos del proyecto y del foco de la semana. "Es principal" suma pero no se escribe: se repetiría en casi todo.
  const comunes = (p, o, motivos) => {
    let puntos = p.tipo === 'principal' ? 25 : 0;
    if (foco.has(o.id)) {
      puntos += 20;
      motivos.push('Es tu foco de la semana');
    }
    const dias = diasEntre(ultimoAvance(p, datos), hoy);
    if (dias >= 3) {
      puntos += Math.min(30, 3 * dias);
      motivos.push(`Llevas ${dias} días sin avanzar en ${p.nombre}`);
    }
    return puntos;
  };
  // Un proyecto sin ninguna actividad todavía (ni tiempo, ni tarea hecha, ni nota): su primera tarea es «el primer paso».
  const sinArrancar = new Map();
  const proyectoSinArrancar = (p) => {
    if (!sinArrancar.has(p.id)) {
      const ids = new Set(objetivosDe(datos, p.id).map((x) => x.id));
      sinArrancar.set(p.id, !datos.registros.some((r) => ids.has(r.objetivoId)) && !datos.tareas.some((t) => ids.has(t.objetivoId) && (t.hecha || t.tocado)) && !datos.notas.some((n) => ids.has(n.objetivoId)));
    }
    return sinArrancar.get(p.id);
  };
  // Si el plazo ya venció, la tarjeta ofrece moverlo, quitarlo o darlo por hecho.
  const vencido = (fecha, tipo, id) => (fecha && fecha < hoy ? { tipo, id, fecha } : null);

  for (const o of datos.objetivos) {
    const p = proyectos.get(o.proyectoId);
    if (!p || p.estado !== 'activo' || o.archivado) continue;
    const mp = motivoPlazo(o.plazo, hoy);

    if (o.tipo === 'tiempo') {
      const clave = `o:${o.id}`;
      if (fuera.has(clave)) continue;
      const conteo = esConteo(o);
      const unidades = conteo ? unidadesSugeridas(o, datos, hoy) : 0;
      const minutos = conteo ? unidades * o.minutosPorUnidad : minutosSugeridosTiempo(o, datos, hoy);
      if (!minutos) continue;
      const motivos = [];
      let puntos = 5;
      const hecho = conteo ? cantidadRegistrada(datos, o.id, o.periodo, hoy) : minutosRegistrados(datos, o.id, o.periodo, hoy);
      const meta = conteo ? o.metaCantidad : o.minutosMeta;
      const fmt = (n) => (conteo ? textoCantidad(o, n) : formatoDuracion(n));
      if (o.periodo === 'semana') {
        // Atraso respecto de lo esperado a esta altura de la semana, y un empujón
        // cuando quedan 3 días o menos y lo que falta ya no cabe a ritmo normal: si no, una tarea
        // vieja le gana siempre y el ritmo semanal se queda en cero.
        const indice = indiceEnSemana(hoy);
        // Un objetivo creado esta semana no se mide contra una semana entera: cuenta desde el día en que existe.
        const creadoEstaSemana = !!o.creado && o.creado >= inicioSemana(hoy);
        const desde = creadoEstaSemana ? indiceEnSemana(o.creado) : 0;
        const esperado = (meta * (indice - desde)) / 7;
        const quedan = 7 - indice;
        // Los primeros días pesa como antes (hasta 40): un plazo cercano de una tarea debe ganarle. Al final de la semana, hasta 70.
        const maximo = quedan <= 3 ? PUNTOS_ATRASO_RITMO : PUNTOS_ATRASO_INICIO;
        if (hecho < esperado) puntos += Math.round((maximo * (esperado - hecho)) / meta);
        const apurado = !creadoEstaSemana && quedan <= 3 && (meta - hecho) / quedan > (1.5 * meta) / 7;
        if (apurado) puntos += 15;
        motivos.push(`Vas ${conteo ? `${hecho} de ${textoCantidad(o, meta)}` : `${fmt(hecho)} de ${fmt(meta)}`} esta semana${apurado ? ` y ${quedan === 1 ? 'hoy es el último día' : `quedan ${quedan} días`}` : ''}`);
      } else {
        motivos.push(`Llevas ${conteo ? `${hecho} de ${textoCantidad(o, meta)}` : `${fmt(hecho)} de ${fmt(meta)}`}`);
      }
      if (mp) {
        puntos += mp.puntos;
        motivos.unshift(mp.texto);
      }
      puntos += comunes(p, o, motivos);
      lista.push({ clave, tipo: 'tiempo', proyecto: p, objetivo: o, tarea: null, minutos, unidades: conteo ? unidades : null, puntos, motivos, ajustable: true, vencido: vencido(o.plazo, 'objetivo', o.id) });
      continue;
    }

    if (o.logrado) continue;
    const tareas = tareasDe(datos, o.id);
    const pendientes = tareas.filter((t) => !t.hecha);
    // Las que esperan algo (una respuesta, un trámite) no se recomiendan hasta su fecha, y no frenan a las siguientes.
    const disponibles = pendientes.filter((t) => !enEspera(t, hoy));

    // Objetivo sin tareas pendientes: la recomendación es planificarlo.
    if (!pendientes.length) {
      const clave = `p:${o.id}`;
      if (fuera.has(clave)) continue;
      const motivos = [tareas.length ? 'Todas sus tareas están hechas: define las siguientes o márcalo logrado' : 'Todavía no tiene tareas'];
      let puntos = 15;
      if (mp) {
        puntos += mp.puntos;
        motivos.unshift(mp.texto);
      }
      puntos += comunes(p, o, motivos);
      lista.push({ clave, tipo: 'planificar', proyecto: p, objetivo: o, tarea: null, minutos: MINUTOS_PLANIFICAR, puntos, motivos, ajustable: false, sinTareas: !tareas.length, vencido: vencido(o.plazo, 'objetivo', o.id) });
      continue;
    }

    if (!disponibles.length) continue; // todo lo que le queda está en espera
    // Las tareas van en orden: se recomiendan solo las primeras pendientes del objetivo
    // (no "Enviar la postulación" antes de "Leer las bases"), salvo que una tenga su propio plazo cercano.
    const enOrden = new Set(disponibles.slice(0, TAREAS_EN_ORDEN).map((t) => t.id));
    // En objetivos de 3 o más tareas, la última (suele ser "Enviar" o "Entregar") espera a que las demás estén hechas.
    if (tareas.length >= 3 && pendientes.length > 1) enOrden.delete(pendientes.at(-1).id);
    // Gradiente de meta: cerca de lograr el objetivo, el impulso sube (Kivetz y otros, 2006).
    const avanceObjetivo = progresoObjetivo(o, datos, hoy).valor;
    const cerca = pendientes.length === 1
      ? `Es la última tarea para lograr "${o.nombre}"`
      : avanceObjetivo >= CERCA_DE_LA_META ? `Te falta poco para lograr "${o.nombre}" (${porcentaje(avanceObjetivo)})` : null;
    for (const t of disponibles) {
      const clave = `t:${t.id}`;
      if (fuera.has(clave)) continue;
      const plazoPropio = t.plazo ? diasEntre(hoy, t.plazo) : null;
      if (!enOrden.has(t.id) && !(plazoPropio !== null && plazoPropio <= 7)) continue;
      const motivos = [];
      let puntos = 0;
      const mpt = motivoPlazo(t.plazo ?? o.plazo, hoy);
      if (mpt) {
        puntos += mpt.puntos;
        motivos.push(mpt.texto);
      }
      const falta = faltantesDeTarea(datos, t.id)[0];
      if (falta) {
        puntos += 15;
        motivos.push(`Anotaste que falta: ${falta.texto.length > 80 ? `${falta.texto.slice(0, 80)}…` : falta.texto}`);
      }
      puntos += comunes(p, o, motivos);
      // Lo que elegiste ayer como tu primer paso de hoy (intención de implementación): va primero.
      if (datos.meta?.primerPaso?.para === hoy && datos.meta.primerPaso.clave === clave) {
        puntos += PUNTOS_PRIMER_PASO;
        motivos.unshift('Elegiste empezar por esto');
      }
      const quieta = diasEntre(t.tocado ?? t.creado, hoy);
      if (quieta >= 2) puntos += Math.min(21, 3 * quieta);
      if (quieta >= 3) motivos.push(`Llevas ${quieta} días sin tocarla`);
      if (cerca && tareas.length > 1) {
        puntos += 12;
        motivos.unshift(cerca);
      }
      const prog = progresoTarea(t, datos);
      if (prog > 0) {
        puntos += 10;
        motivos.push(`Ya la empezaste (${porcentaje(prog)})`);
      }
      const siguiente = t.pasos.find((x) => !x.hecho);
      if (siguiente) motivos.push(`Siguiente paso: ${siguiente.texto}`);
      if (!motivos.length) motivos.push(`Avanza tu objetivo "${o.nombre}"`);
      // Terminó la espera: ya puedes retomarla.
      if (t.noAntesDe && t.esperando) {
        puntos += 10;
        motivos.unshift(`Ya puedes retomarla (esperabas: ${t.esperando.length > 60 ? `${t.esperando.slice(0, 60)}…` : t.esperando})`);
      }
      // Arrancar un proyecto nuevo: antes de «dedicarle horas», lo concreto de la primera tarea.
      if (t.id === disponibles[0].id && proyectoSinArrancar(p)) {
        puntos += PUNTOS_ARRANQUE;
        const generico = motivos.indexOf(`Avanza tu objetivo "${o.nombre}"`);
        if (generico >= 0) motivos.splice(generico, 1);
        motivos.splice(motivos[0]?.startsWith('Ya puedes retomarla') ? 1 : 0, 0, 'Es lo primero para arrancar este proyecto');
      }
      // En empate, primero la que va antes en el orden (y no la más corta).
      if (t.id === disponibles[0].id && disponibles.length > 1) puntos += 1;
      const minutosT = minutosSesion(t, datos);
      const costo = costoTarea(t, minutosT, factorTareas);
      if (costo !== minutosT) motivos.push(`Sueles tardar ×${factorTareas.toFixed(1).replace('.', ',')} lo que estimas: cuenta ${formatoDuracion(costo)} de tu día`);
      lista.push({
        clave, tipo: 'tarea', proyecto: p, objetivo: o, tarea: t, minutos: minutosT, costo, puntos, motivos, ajustable: t.tamano !== 'simple',
        vencido: t.plazo ? vencido(t.plazo, 'tarea', t.id) : vencido(o.plazo, 'objetivo', o.id),
      });
    }
  }
  return lista.sort(
    (a, b) => b.puntos - a.puntos || a.minutos - b.minutos || (a.tarea?.titulo ?? a.objetivo.nombre).localeCompare(b.tarea?.titulo ?? b.objetivo.nombre, 'es'),
  );
}

/**
 * Elige hasta 3 recomendaciones que quepan en los minutos disponibles, máximo 2 por objetivo.
 * Las sesiones ajustables (tiempo, tareas medias y amplias) se acortan para caber, con un mínimo de 15 min.
 */
export function elegirRecomendaciones(lista, disponibles, max = MAX_RECOMENDACIONES) {
  const elegidas = [];
  const porObjetivo = new Map();
  let quedan = disponibles;
  for (const c of lista) {
    if (elegidas.length >= max) break;
    if ((porObjetivo.get(c.objetivo.id) ?? 0) >= MAX_POR_OBJETIVO) continue;
    let minutos = c.minutos;
    let unidades = c.unidades ?? null;
    const k = c.costo && c.minutos ? c.costo / c.minutos : 1; // lo que de verdad ocupa cada minuto estimado
    if (minutos * k > quedan) {
      if (!c.ajustable) continue;
      if (unidades) {
        // Por conteo: entran las unidades enteras que quepan (cada una con su tiempo).
        const porUnidad = c.objetivo.minutosPorUnidad;
        unidades = Math.floor(quedan / porUnidad);
        if (unidades < 1) continue;
        minutos = unidades * porUnidad;
      } else {
        minutos = Math.floor(quedan / k / 5) * 5;
        if (minutos < SESION_MIN) continue;
      }
    }
    elegidas.push(minutos === c.minutos ? c : { ...c, minutos, costo: c.costo ? Math.round(minutos * k) : c.costo, unidades, acortada: true });
    porObjetivo.set(c.objetivo.id, (porObjetivo.get(c.objetivo.id) ?? 0) + 1);
    quedan -= Math.round(minutos * k);
  }
  return elegidas;
}

/** Todo lo que necesita la pantalla Hoy. */
export function vistaHoy(datos, hoy, { ignorarCapacidad = false, soloPoquito = false } = {}) {
  const items = resolverItems(datos, planDeHoy(datos, hoy));
  const hechos = minutosHoy(datos, hoy);
  const factor = factorEstimacion(datos);
  const pendientes = items.filter((i) => !i.hecho).reduce((s, i) => s + (i.tipo === 'tarea' ? costoTarea(i.tarea, i.minutos, factor) : i.minutos), 0);
  const libres = minutosLibres(datos.disponibilidad, hoy);
  const capacidad = capacidadDia(datos.disponibilidad, hoy);
  const todos = candidatos(datos, hoy);
  const recomendaciones = soloPoquito
    ? recomendacionMinima(todos)
    : elegirRecomendaciones(todos, ignorarCapacidad ? Infinity : capacidad - hechos - pendientes);
  // Un proyecto secundario olvidado aparece aparte, "si te sobra tiempo", para que no quede siempre fuera.
  const elegidas = new Set(recomendaciones.map((c) => c.clave));
  const extra =
    todos.find(
      (c) =>
        !elegidas.has(c.clave) &&
        c.proyecto.tipo === 'secundario' &&
        !recomendaciones.some((r) => r.proyecto.id === c.proyecto.id) &&
        diasEntre(ultimoAvance(c.proyecto, datos), hoy) >= DIAS_SECUNDARIO_OLVIDADO,
    ) ?? null;
  return {
    items,
    minutosHechos: hechos,
    minutosPlaneados: hechos + pendientes,
    libres,
    capacidad,
    disponibles: capacidad - hechos - pendientes,
    recomendaciones,
    extra: soloPoquito ? null : extra,
    hayMas: todos.length > 0,
    soloPoquito,
  };
}

/** Minutos de «un poquito»: lo mínimo que de verdad cuenta como empezar. */
export const MINUTOS_POQUITO = 15;

/**
 * Para los días de poca energía o tiempo: UNA sola cosa, la más importante que se pueda hacer en un rato corto
 * (una tarea simple, o una sesión acortada a 15 min). Empezar poco sigue siendo avanzar.
 */
export function recomendacionMinima(todos) {
  for (const c of todos) {
    if (c.tipo === 'planificar') continue; // «planificar» no es hacer: se ofrece, pero después de algo concreto
    if (c.unidades) {
      // Por cantidad: una unidad entera, si entra en un rato corto.
      if (c.objetivo.minutosPorUnidad <= 30) return [{ ...c, unidades: 1, minutos: c.objetivo.minutosPorUnidad, acortada: c.unidades !== 1 }];
      continue;
    }
    if (c.minutos <= 20) return [c];
    if (c.ajustable) {
      const k = c.costo && c.minutos ? c.costo / c.minutos : 1;
      return [{ ...c, minutos: MINUTOS_POQUITO, costo: Math.round(MINUTOS_POQUITO * k), acortada: true }];
    }
  }
  return [];
}

/**
 * Cierre del día: qué podría ser tu primer paso de mañana (las 4 cosas que más conviene empezar), para elegir una.
 * Lo elegido se guarda en `meta.primerPaso = { para: fecha, clave }` y mañana va primero.
 */
export function opcionesParaManana(datos, hoy) {
  const manana = sumarDias(hoy, 1);
  return candidatos(datos, manana)
    .filter((c) => c.tipo !== 'planificar')
    .slice(0, 4)
    .map((c) => ({ clave: c.clave, titulo: c.tarea?.titulo ?? (c.unidades ? `${c.objetivo.nombre}: ${textoCantidad(c.objetivo, c.unidades)}` : c.objetivo.nombre), proyecto: c.proyecto.nombre, minutos: c.minutos }));
}

/** ¿Toca ofrecer el cierre del día? Cuando ya hiciste algo hoy y aún no elegiste tu primer paso de mañana. */
export function tocaCierreDelDia(datos, hoy) {
  if (datos.meta?.primerPaso?.para === sumarDias(hoy, 1)) return false;
  return minutosHoy(datos, hoy) > 0 || datos.tareas.some((t) => t.hechaEl === hoy);
}

/**
 * Tu semana en un texto corto y positivo para compartir con quien te acompaña (por ejemplo, un amigo o tu pareja).
 * Solo lo que tú decidas compartir: cuentas, nombres de proyectos y títulos de tareas terminadas.
 */
export function resumenParaCompartir(datos, hoy) {
  const desde = sumarDias(hoy, -6);
  const a = avanceSemanal(datos, hoy);
  const fecha = (f) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${f}T12:00:00Z`));
  const terminadas = datos.tareas.filter((t) => t.hechaEl && t.hechaEl >= desde && t.hechaEl <= hoy).sort((x, y) => x.hechaEl.localeCompare(y.hechaEl));
  const lineas = [`Mi semana en Rumbo (${fecha(desde)} – ${fecha(hoy)})`, ''];
  lineas.push(`• ${a.terminadas === 1 ? '1 tarea terminada' : `${a.terminadas} tareas terminadas`}`);
  lineas.push(`• ${formatoDuracion(a.minutos)} dedicadas, en ${a.diasConAvance} de 7 días`);
  if (a.aceptados) lineas.push(`• Hice ${a.hechos} de las ${a.aceptados} cosas que me propuse en mi plan`);
  if (a.porProyecto.length) lineas.push(`• Mi tiempo fue sobre todo a: ${a.porProyecto.slice(0, 2).map((x) => x.proyecto.nombre).join(' y ')}`);
  const logrados = datos.objetivos.filter((o) => o.logradoEl && o.logradoEl >= desde && o.logradoEl <= hoy);
  for (const o of logrados) lineas.push(`• Logré: ${o.nombre}`);
  if (terminadas.length) {
    lineas.push('', 'Lo que terminé:');
    for (const t of terminadas.slice(-6)) lineas.push(`✓ ${t.titulo}`);
    if (terminadas.length > 6) lineas.push(`…y ${terminadas.length - 6} más`);
  }
  return lineas.join('\n');
}


// ---------- Orden, foco, regreso y revisión semanal ----------

/** Sube (-1) o baja (+1) una tarea dentro de su objetivo. Modifica `d`. */
export function moverEnOrden(d, tareaId, delta) {
  const t = d.tareas.find((x) => x.id === tareaId);
  const hermanas = d.tareas.map((x, i) => [x, i]).filter(([x]) => x.objetivoId === t.objetivoId);
  const pos = hermanas.findIndex(([x]) => x.id === tareaId);
  const otra = hermanas[pos + delta];
  if (!otra) return false;
  const i = hermanas[pos][1];
  const j = otra[1];
  [d.tareas[i], d.tareas[j]] = [d.tareas[j], d.tareas[i]];
  return true;
}

/** Objetivos elegidos como foco en la revisión de esta semana (vacío si la revisión es de otra semana). */
export function focoDeLaSemana(datos, hoy) {
  const f = datos.foco;
  return new Set(f && f.semana === inicioSemana(hoy) ? f.objetivos : []);
}

/** Días desde la última vez que abriste Rumbo (0 si es hoy o la primera vez). */
export const diasFuera = (meta, hoy) => (meta.ultimaVisita ? Math.max(0, diasEntre(meta.ultimaVisita, hoy)) : 0);

/**
 * La revisión semanal se propone el domingo y el lunes, si no la hiciste en los últimos 2 días.
 * (Hecha el domingo, no reaparece el lunes; hecha el lunes, vuelve el domingo siguiente.)
 */
export function tocaRevisionSemanal(meta, hoy) {
  const dia = diaSemana(hoy);
  if (dia !== 0 && dia !== 1) return false;
  // Una persona nueva no tiene una semana que revisar: se ofrece desde la segunda semana de uso.
  if (meta.creado && diasEntre(meta.creado, hoy) < 6) return false;
  return !meta.ultimaRevision || diasEntre(meta.ultimaRevision, hoy) >= 2;
}

/** Todo lo que necesita la revisión semanal: lo logrado en 7 días, lo vencido, lo olvidado y lo por ordenar. */
export function resumenSemana(datos, hoy) {
  const desde = sumarDias(hoy, -6);
  const proyectos = indexar(datos.proyectos);
  const objetivos = indexar(datos.objetivos);
  const activo = (o) => o && !o.archivado && proyectos.get(o.proyectoId)?.estado === 'activo';
  const minutosPorDia = Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(desde, i);
    return { fecha, minutos: minutosHoy(datos, fecha) };
  });
  const tareasVencidas = datos.tareas
    .filter((t) => !t.hecha && t.plazo && t.plazo < hoy && activo(objetivos.get(t.objetivoId)))
    .map((t) => ({ tipo: 'tarea', id: t.id, nombre: t.titulo, fecha: t.plazo, objetivo: objetivos.get(t.objetivoId) }));
  const objetivosVencidos = datos.objetivos
    .filter((o) => activo(o) && !o.logrado && o.plazo && o.plazo < hoy)
    .map((o) => ({ tipo: 'objetivo', id: o.id, nombre: o.nombre, fecha: o.plazo, objetivo: o }));
  return {
    desde,
    minutosPorDia,
    minutos: minutosPorDia.reduce((s, x) => s + x.minutos, 0),
    terminadas: datos.tareas.filter((t) => t.hechaEl && t.hechaEl >= desde && t.hechaEl <= hoy),
    vencidos: [...objetivosVencidos, ...tareasVencidas],
    olvidados: datos.proyectos.filter((p) => p.estado === 'activo' && diasEntre(ultimoAvance(p, datos), hoy) >= DIAS_SECUNDARIO_OLVIDADO),
    porOrdenar: datos.bandeja.length,
    enRiesgo: datos.objetivos
      .filter(activo)
      .map((o) => ({ objetivo: o, riesgo: riesgoPlazo(o, datos, hoy) }))
      .filter((x) => x.riesgo && x.riesgo.estado === 'en-riesgo'),
    objetivosActivos: datos.objetivos.filter(activo),
    diasConAvance: diasConAvance(datos, desde, hoy),
  };
}

/** Días distintos con algún avance (tiempo, tarea terminada, paso o nota) entre dos fechas: pequeños logros visibles. */
export function diasConAvance(datos, desde, hasta) {
  const dias = new Set();
  const dentro = (f) => f && f >= desde && f <= hasta;
  for (const r of datos.registros) if (dentro(r.fecha)) dias.add(r.fecha);
  for (const t of datos.tareas) {
    if (dentro(t.hechaEl)) dias.add(t.hechaEl);
    if (dentro(t.tocado)) dias.add(t.tocado);
  }
  for (const n of datos.notas) if (dentro(n.fecha)) dias.add(n.fecha);
  return dias.size;
}

/**
 * ¿Caben tus metas semanales en tu tiempo? Suma las metas de los objetivos de tiempo semanales (de proyectos activos)
 * y las compara con lo que Rumbo planifica en los próximos 7 días (70% de tus minutos libres, con ciclo de turnos y días especiales).
 * `sobrecargada` cuando las metas piden más de lo planificable.
 */
export function cargaSemanal(datos, hoy) {
  const activos = new Set(datos.proyectos.filter((p) => p.estado === 'activo').map((p) => p.id));
  const metas = datos.objetivos.filter((o) => esRitmoSemanal(o) && !o.archivado && activos.has(o.proyectoId));
  const demanda = metas.reduce((s, o) => s + o.minutosMeta, 0);
  let capacidad = 0;
  for (let i = 0; i < 7; i++) capacidad += capacidadDia(datos.disponibilidad, sumarDias(hoy, i));
  return { demanda, capacidad, exceso: Math.max(0, demanda - capacidad), sobrecargada: demanda > capacidad, metas };
}

/**
 * ¿Cuánto más (o menos) tardas de lo que estimas? Compara los minutos registrados en tareas terminadas con sus minutos
 * estimados. Con menos de 4 tareas medibles no opina. `factor` 1,5 = tardas la mitad más.
 */
export function calibracionEstimaciones(datos) {
  let real = 0;
  let estimado = 0;
  let n = 0;
  for (const t of datos.tareas) {
    if (!t.hecha || t.tamano === 'simple') continue;
    const minutos = minutosTrabajados(datos, t.id);
    if (minutos <= 0) continue;
    real += minutos;
    estimado += t.minutos;
    n++;
  }
  if (n < 4 || !estimado) return null;
  return { factor: real / estimado, n, real, estimado };
}

/**
 * Cuánto multiplicar tus estimaciones al planificar el día: tu calibración (cuánto más o menos tardas de lo que estimas),
 * solo cuando hay datos suficientes y la diferencia importa (menos de 15% se ignora). Entre ×0,7 y ×2.
 */
export function factorEstimacion(datos) {
  const c = calibracionEstimaciones(datos);
  if (!c || (c.factor > 0.85 && c.factor < 1.15)) return 1;
  return Math.min(2, Math.max(0.7, c.factor));
}

/** Lo que una tarea de verdad ocupa de tu día: su estimación por tu factor (las simples y el resto, tal cual). */
const costoTarea = (t, minutos, factor) => (t && t.tamano !== 'simple' ? Math.round(minutos * factor) : minutos);

/** Todo lo de la pantalla «Mi avance»: esta semana contra la anterior, plan cumplido, metas, riesgos, carga y estimaciones. */
export function avanceSemanal(datos, hoy) {
  const desde = sumarDias(hoy, -6);
  const previoDesde = sumarDias(desde, -7);
  const previoHasta = sumarDias(desde, -1);
  const min = (a, b) => datos.registros.filter((r) => r.fecha >= a && r.fecha <= b).reduce((s, r) => s + r.minutos, 0);
  const terminadas = (a, b) => datos.tareas.filter((t) => t.hechaEl && t.hechaEl >= a && t.hechaEl <= b).length;
  let aceptados = 0;
  let hechos = 0;
  for (const [fecha, plan] of Object.entries(datos.planes)) {
    if (fecha < desde || fecha > hoy) continue;
    aceptados += plan.items.length;
    hechos += plan.items.filter((i) => i.hecho).length;
  }
  const proyectos = new Map(datos.proyectos.map((p) => [p.id, p]));
  const objetivos = new Map(datos.objetivos.map((o) => [o.id, o]));
  const porProyecto = new Map();
  for (const r of datos.registros) {
    if (r.fecha < desde || r.fecha > hoy) continue;
    const p = proyectos.get(objetivos.get(r.objetivoId)?.proyectoId);
    if (p) porProyecto.set(p.id, (porProyecto.get(p.id) ?? 0) + r.minutos);
  }
  const resumen = resumenSemana(datos, hoy);
  const carga = cargaSemanal(datos, hoy);
  return {
    desde,
    minutos: min(desde, hoy),
    minutosPrevios: min(previoDesde, previoHasta),
    terminadas: terminadas(desde, hoy),
    terminadasPrevias: terminadas(previoDesde, previoHasta),
    aceptados,
    hechos,
    diasConAvance: resumen.diasConAvance,
    metas: carga.metas.map((o) => ({ objetivo: o, ...progresoObjetivo(o, datos, hoy) })),
    enRiesgo: resumen.enRiesgo,
    carga,
    calibracion: calibracionEstimaciones(datos),
    resultados: datos.objetivos
      .filter((o) => !o.archivado && proyectos.get(o.proyectoId)?.estado === 'activo' && (o.indicadores ?? []).length)
      .map((o) => ({ objetivo: o, indicadores: resumenIndicadores(o, datos, hoy) })),
    porProyecto: [...porProyecto.entries()].map(([id, minutos]) => ({ proyecto: proyectos.get(id), minutos })).sort((a, b) => b.minutos - a.minutos),
  };
}

/** Mensaje de nuevo comienzo: lunes, día 1 del mes o regreso tras días fuera (efecto de nuevo comienzo). */
export function nuevoComienzo(hoy, diasAusente = 0, creado = null) {
  if (diasAusente >= DIAS_PARA_BIENVENIDA) return null; // ya lo cubre la bienvenida de regreso
  if (creado && diasEntre(creado, hoy) < 3) return null; // quien acaba de llegar no tiene una semana pasada que soltar
  if (hoy.endsWith('-01')) return 'Empieza un mes nuevo: buen día para retomar lo que más te importa.';
  if (diaSemana(hoy) === 1) return 'Semana nueva, borrón y cuenta nueva: lo de la semana pasada ya no pesa.';
  return null;
}

/**
 * Celebración tras un avance: compara el progreso del proyecto antes y después de un cambio.
 * Devuelve null si no subió; si un objetivo de resultado llegó a 100%, lo dice.
 */
export function celebracion(antes, despues, proyectoId, hoy) {
  const p = despues.proyectos.find((x) => x.id === proyectoId);
  if (!p) return null;
  const a = progresoProyecto(p, antes, hoy);
  const d = progresoProyecto(p, despues, hoy);
  const logrado = objetivosDe(despues, proyectoId).find((o) => {
    if (o.tipo !== 'resultado' || o.archivado) return false;
    const previo = antes.objetivos.find((x) => x.id === o.id);
    return previo && progresoObjetivo(previo, antes, hoy).valor < 1 && progresoObjetivo(o, despues, hoy).valor >= 1;
  });
  if (logrado) return { grande: true, texto: `¡Lograste "${logrado.nombre}"! ${p.nombre} va en ${porcentaje(d ?? 1)}.` };
  if (a === null || d === null || d <= a) return null;
  return { grande: false, texto: `${p.nombre}: ${porcentaje(a)} → ${porcentaje(d)}.` };
}

// ---------- Ideas con IA (copiar y pegar, sin API) ----------

const recortar = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Texto que la persona revisa, copia y pega en su chat de Claude o ChatGPT. Solo incluye lo que se ve en pantalla:
 * proyecto, objetivo, meta concreta, tareas, notas y lo logrado en etapas anteriores (para no partir de cero).
 */
export function textoParaIdeas(datos, proyecto, objetivo) {
  const tareas = tareasDe(datos, objetivo.id);
  const etapas = etapasAnteriores(datos, objetivo);
  const lineas = [
    etapas.length ? 'Ayúdame a llevar más lejos un objetivo que ya logré en uno de mis proyectos.' : 'Ayúdame a avanzar en un objetivo de uno de mis proyectos.',
    '',
    `Proyecto: ${proyecto.nombre} (${proyecto.tipo})`,
  ];
  if (proyecto.descripcion?.trim()) lineas.push(`De qué se trata: ${proyecto.descripcion.trim()}`);

  if (etapas.length) {
    lineas.push('', 'Lo que ya logré en etapas anteriores de este objetivo (no quiero partir de cero):');
    for (const e of [...etapas].reverse()) {
      lineas.push(`- Etapa ${e.etapa}: ${e.nombre}${e.criterio ? ` (meta: ${e.criterio})` : ''}`);
      const hechas = tareasDe(datos, e.id).filter((t) => t.hecha).map((t) => t.titulo);
      if (hechas.length) lineas.push(`  Tareas hechas: ${hechas.slice(0, 12).join('; ')}`);
      for (const n of notasDeObjetivo(datos, e.id).filter((x) => !x.falta).slice(0, 3)) lineas.push(`  Nota: ${recortar(n.texto, 200)}`);
      for (const n of faltantesDeObjetivo(datos, e.id).slice(0, 3)) lineas.push(`  Quedó pendiente: ${recortar(n.texto, 200)}`);
    }
  }

  lineas.push('', `Objetivo${etapas.length ? ` actual (etapa ${objetivo.etapa})` : ''}: ${objetivo.nombre}`);
  if (objetivo.criterio?.trim()) lineas.push(`Sabré que lo logré cuando: ${objetivo.criterio.trim()}`);
  if (objetivo.plazo) lineas.push(`Plazo del objetivo: ${objetivo.plazo}`);
  for (const n of notasDeObjetivo(datos, objetivo.id).slice(0, 5)) lineas.push(`Nota mía: ${recortar(n.texto, 200)}`);

  lineas.push('', tareas.length ? 'Tareas que ya tengo:' : 'Todavía no tengo tareas para este objetivo.');
  for (const t of tareas) {
    lineas.push(`- ${t.titulo} (${t.hecha ? 'hecha' : `pendiente, ${porcentaje(progresoTarea(t, datos))}`})`);
    for (const n of faltantesDeTarea(datos, t.id).slice(0, 2)) lineas.push(`  Falta: ${recortar(n.texto, 200)}`);
  }
  lineas.push(
    '',
    `Propón entre 3 y 6 tareas NUEVAS, concretas y en orden, para ${etapas.length ? 'profundizar a partir de lo ya logrado' : 'avanzar en este objetivo'}. No repitas las que ya tengo.`,
    'Cada tarea tiene un tamaño:',
    '- "simple": hasta 30 minutos, sin pasos.',
    '- "media": de 30 a 120 minutos, con 2 a 5 pasos.',
    '- "amplia": más de 120 minutos, con 3 a 8 pasos que quepan en sesiones de hasta 60 minutos.',
    '',
    'Responde SOLO con un bloque JSON con este formato exacto, sin texto adicional:',
    '{"tareas":[{"titulo":"...","tamano":"simple","minutos":20,"pasos":[]},{"titulo":"...","tamano":"media","minutos":60,"pasos":["...","..."]}]}',
  );
  return lineas.join('\n');
}

/**
 * Lee la respuesta pegada. Es contenido no confiable: se valida cada campo y se descartan las tareas inválidas.
 * Devuelve { ok, ideas: [{titulo, tamano, minutos, pasos: [texto]}], errores }.
 */
export function leerIdeas(texto) {
  const r = extraerJson(texto);
  if (r.error) return { ok: false, ideas: [], errores: [r.error] };
  const obj = r.obj;
  if (!obj || !Array.isArray(obj.tareas)) return { ok: false, ideas: [], errores: ['La respuesta no trae la lista "tareas".'] };
  const ideas = [];
  const errores = [];
  obj.tareas.slice(0, 10).forEach((t, i) => {
    const idea = validarIdeaTarea(t, `Idea ${i + 1}`, errores);
    if (idea) ideas.push(idea);
  });
  if (obj.tareas.length > 10) errores.push(`Venían ${obj.tareas.length} ideas; solo reviso las primeras 10.`);
  return { ok: ideas.length > 0, ideas, errores: ideas.length ? errores : [...errores, 'No quedó ninguna idea válida.'] };
}

/** Saca el bloque JSON de una respuesta pegada (con o sin texto y bloque de código alrededor). */
function extraerJson(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return { error: 'Pega la respuesta primero.' };
  if (texto.length > 50000) return { error: 'La respuesta es demasiado larga.' };
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio < 0 || fin < inicio) return { error: 'No encontré un bloque JSON en la respuesta.' };
  try {
    return { obj: JSON.parse(texto.slice(inicio, fin + 1)) };
  } catch {
    return { error: 'El JSON de la respuesta está mal formado. Pídele que responda solo con el JSON.' };
  }
}

/** Valida una tarea propuesta por la IA. Devuelve la tarea limpia, o null y anota el motivo en `errores`. */
function validarIdeaTarea(t, n, errores) {
  if (!t || typeof t !== 'object') return errores.push(`${n}: no es una tarea.`) && null;
  const titulo = typeof t.titulo === 'string' ? t.titulo.trim() : '';
  if (!titulo || titulo.length > 200) return errores.push(`${n}: título vacío o muy largo.`) && null;
  if (!Object.hasOwn(TAMANOS, t.tamano)) return errores.push(`${n}: tamaño "${String(t.tamano).slice(0, 20)}" no válido.`) && null;
  if (!Number.isInteger(t.minutos) || t.minutos < 5 || t.minutos > LIMITES.minutos) return errores.push(`${n}: minutos no válidos.`) && null;
  const pasos = Array.isArray(t.pasos) ? t.pasos : [];
  if (pasos.length > 10 || !pasos.every((p) => typeof p === 'string' && p.trim() && p.length <= 200)) return errores.push(`${n}: pasos no válidos.`) && null;
  return { titulo, tamano: t.tamano, minutos: t.minutos, pasos: pasos.map((p) => p.trim()) };
}

/** Texto para pedirle a Claude ideas de OBJETIVOS (con sus primeras tareas) para un proyecto. */
export function textoIdeasObjetivos(datos, proyecto) {
  const objetivos = objetivosDe(datos, proyecto.id);
  const lineas = ['Ayúdame a definir objetivos concretos para uno de mis proyectos.', '', `Proyecto: ${proyecto.nombre} (${proyecto.tipo})`];
  if (proyecto.descripcion?.trim()) lineas.push(`De qué se trata: ${proyecto.descripcion.trim()}`);
  lineas.push('', objetivos.length ? 'Objetivos que ya tengo o ya logré:' : 'Todavía no tengo objetivos para este proyecto.');
  for (const o of objetivos) {
    const estado = o.archivado || o.logrado ? 'logrado' : 'en curso';
    lineas.push(`- ${o.nombre} (${estado}${o.criterio ? `; meta: ${o.criterio}` : ''})`);
  }
  lineas.push(
    '',
    'Propón entre 2 y 4 objetivos NUEVOS, concretos y verificables, en orden. No repitas los que ya tengo.',
    'Cada objetivo es de uno de estos tipos:',
    '- "resultado": se completa con tareas. Incluye "criterio" (cómo sabré que lo logré) y de 2 a 6 tareas.',
    '- "tiempo": dedicarle horas cada semana (por ejemplo, estudiar). Incluye "horasPorSemana".',
    'Cada tarea tiene tamaño "simple" (hasta 30 min, sin pasos), "media" (30 a 120 min, 2 a 5 pasos) o "amplia" (más de 120 min, 3 a 8 pasos).',
    '',
    'Responde SOLO con un bloque JSON con este formato exacto, sin texto adicional:',
    '{"objetivos":[{"nombre":"...","tipo":"resultado","criterio":"...","tareas":[{"titulo":"...","tamano":"media","minutos":60,"pasos":["...","..."]}]},{"nombre":"...","tipo":"tiempo","horasPorSemana":3}]}',
  );
  return lineas.join('\n');
}

/**
 * Lee ideas de objetivos pegadas (contenido no confiable). Descarta lo inválido y explica por qué.
 * Devuelve { ok, ideas: [{nombre, criterio, tipo, minutosMeta, periodo, tareas}], errores }.
 */
export function leerIdeasObjetivos(texto) {
  const r = extraerJson(texto);
  if (r.error) return { ok: false, ideas: [], errores: [r.error] };
  const obj = r.obj;
  if (!obj || !Array.isArray(obj.objetivos)) return { ok: false, ideas: [], errores: ['La respuesta no trae la lista "objetivos".'] };
  const ideas = [];
  const errores = [];
  obj.objetivos.slice(0, 6).forEach((o, i) => {
    const n = `Objetivo ${i + 1}`;
    if (!o || typeof o !== 'object') return errores.push(`${n}: no es un objetivo.`);
    const nombre = typeof o.nombre === 'string' ? o.nombre.trim() : '';
    if (!nombre || nombre.length > LIMITES.texto) return errores.push(`${n}: nombre vacío o muy largo.`);
    const criterio = typeof o.criterio === 'string' ? o.criterio.trim().slice(0, LIMITES.criterio) : '';
    if (o.tipo === 'tiempo') {
      const horas = Number(o.horasPorSemana);
      if (!(horas >= 0.25 && horas <= 100)) return errores.push(`${n}: horas por semana no válidas.`);
      return ideas.push({ nombre, criterio, tipo: 'tiempo', minutosMeta: Math.round(horas * 60), periodo: 'semana', tareas: [] });
    }
    if (o.tipo !== 'resultado') return errores.push(`${n}: tipo "${String(o.tipo).slice(0, 20)}" no válido.`);
    const tareas = [];
    (Array.isArray(o.tareas) ? o.tareas : []).slice(0, 10).forEach((t, j) => {
      const idea = validarIdeaTarea(t, `${n}, tarea ${j + 1}`, errores);
      if (idea) tareas.push(idea);
    });
    ideas.push({ nombre, criterio, tipo: 'resultado', minutosMeta: null, periodo: null, tareas });
  });
  if (obj.objetivos.length > 6) errores.push(`Venían ${obj.objetivos.length} objetivos; solo reviso los primeros 6.`);
  return { ok: ideas.length > 0, ideas, errores: ideas.length ? errores : [...errores, 'No quedó ningún objetivo válido.'] };
}

// ---------- ¿Qué es esto? (clasificar algo antes de cargarlo) y tutorial ----------

/**
 * Árbol de preguntas sí/no para decidir si algo es proyecto (principal, secundario o en pausa), objetivo,
 * tarea o algo que no va en Rumbo. Cada respuesta lleva a otra pregunta o a un resultado. Es una guía
 * práctica de organización, no ciencia.
 */
export const PREGUNTAS_CLASIFICAR = Object.freeze({
  corta: { texto: '¿Se puede hacer en menos de 15 minutos?', ayuda: 'Una llamada, un correo, un trámite rápido.', si: 'parte', no: 'sentadas' },
  parte: { texto: '¿Es parte de un proyecto que tienes o quieres tener?', ayuda: 'Por ejemplo, «pedir la carta de recomendación» es parte de «Postular a un trabajo».', si: 'tarea-simple', no: 'fuera' },
  sentadas: { texto: '¿Lo terminas en una o pocas sentadas, unas horas en total?', ayuda: 'Por ejemplo, «actualizar el CV» o «leer las bases del concurso».', si: 'tarea', no: 'final' },
  final: { texto: '¿Tiene un final claro, un día en que dirás «listo, lo logré»?', ayuda: '«Aprobar el concurso» tiene final. «Estudiar inglés» no.', si: 'varias', no: 'constancia' },
  constancia: { texto: '¿Es algo que quieres hacer con constancia, como estudiar, practicar o entrenar?', ayuda: 'Lo que importa es dedicarle tiempo cada semana, no terminarlo.', si: 'objetivo-tiempo', no: 'idea' },
  varias: { texto: '¿Necesita 3 o más acciones distintas, durante semanas?', ayuda: '«Postular a un trabajo» necesita CV, cartas, documentos y entrevista.', si: 'importa', no: 'objetivo' },
  importa: { texto: 'Si este mes solo pudieras avanzar 2 cosas, ¿estaría esta?', ayuda: 'Piensa en plazos, en tu trabajo, tu plata o tu carrera.', si: 'principal', no: 'este-mes' },
  'este-mes': { texto: '¿Quieres avanzarla este mes, aunque sea un poco?', ayuda: 'Si es para «algún día», mejor dejarla en pausa.', si: 'secundario', no: 'pausado' },
});

export const RESULTADOS_CLASIFICAR = Object.freeze({
  'tarea-simple': { pieza: 'tarea', nombre: 'Una tarea simple', texto: 'Va dentro de un objetivo de su proyecto. Rumbo te la recomendará cuando tengas un rato.' },
  fuera: { pieza: 'fuera', nombre: 'No va en Rumbo', texto: 'Rumbo es para proyectos. Hazla ahora o déjala en los recordatorios del teléfono: así no llena tu lista.' },
  tarea: { pieza: 'tarea', nombre: 'Una tarea', texto: 'Va dentro de un objetivo. Si dura más de 2 horas, márcala amplia y pártela en pasos.' },
  'objetivo-tiempo': { pieza: 'objetivo', nombre: 'Un objetivo de tiempo', texto: 'Va dentro de un proyecto, como «Dedicarle tiempo»: por ejemplo, 3 horas por semana. Avanza con los minutos que registras.' },
  idea: { pieza: 'idea', nombre: 'Todavía es una idea', texto: 'Aún no está claro qué quieres lograr. Déjala en «Por ordenar» y decide en tu revisión semanal.' },
  objetivo: { pieza: 'objetivo', nombre: 'Un objetivo', texto: 'Un resultado concreto dentro de un proyecto. Escribe cómo sabrás que lo lograste y las tareas para llegar.' },
  principal: { pieza: 'proyecto', tipoProyecto: 'principal', nombre: 'Un proyecto principal', texto: 'Es donde está tu foco: Rumbo lo recomienda primero. Mejor tener solo 2 o 3 a la vez.' },
  secundario: { pieza: 'proyecto', tipoProyecto: 'secundario', nombre: 'Un proyecto secundario', texto: 'Avanza cuando te sobra tiempo. Si pasa 7 días sin avanzar, Rumbo te lo recuerda.' },
  pausado: { pieza: 'proyecto', tipoProyecto: 'secundario', estado: 'pausado', nombre: 'Un proyecto para más adelante', texto: 'Créalo en pausa: sale de tu cabeza sin pedirte tiempo. Lo activas cuando sea su momento.' },
});

/** Sigue las respuestas (true = sí) desde la primera pregunta: devuelve la pregunta siguiente o el resultado. */
export function pasoClasificar(respuestas = []) {
  let id = 'corta';
  for (const r of respuestas) {
    const p = PREGUNTAS_CLASIFICAR[id];
    if (!p) break;
    id = r ? p.si : p.no;
  }
  if (PREGUNTAS_CLASIFICAR[id]) return { tipo: 'pregunta', id, numero: respuestas.length + 1, ...PREGUNTAS_CLASIFICAR[id] };
  return { tipo: 'resultado', id, ...RESULTADOS_CLASIFICAR[id] };
}

/** Proyectos principales activos: con más de 3, todo avanza lento. */
export const principalesActivos = (d) => d.proyectos.filter((p) => p.tipo === 'principal' && p.estado === 'activo').length;

/**
 * Lo que el tutorial sigue en vivo a partir de tus datos reales. `libres` viene de fuera:
 * se marca cuando guardas tus minutos libres o confirmas que están bien.
 */
export function avanceTutorial(d, { libres = false } = {}) {
  return {
    proyecto: d.proyectos.length > 0,
    objetivo: d.objetivos.length > 0,
    tareas: d.tareas.length,
    tiempo: d.objetivos.some((o) => o.tipo === 'tiempo'),
    aceptada: Object.values(d.planes).some((p) => p.items.length > 0),
    registrada: d.registros.length > 0 || d.tareas.some((t) => t.hecha),
    // Quien ya aceptó o registró algo siguió con el tiempo que tiene por defecto: ese paso queda dado por hecho.
    libres: libres || Object.values(d.planes).some((p) => p.items.length > 0) || d.registros.length > 0,
  };
}

// ---------- Respaldo ----------

export function diasSinRespaldo(meta, hoy) {
  const desde = meta.ultimoRespaldo ?? meta.creado;
  return desde ? diasEntre(desde, hoy) : 0;
}

/** Respaldo vencido, pero el aviso no se repite todos los días: tras mostrarlo, espera 3 días (si no, se aprende a ignorarlo). */
export const tocaRecordarRespaldo = (meta, hoy) =>
  diasSinRespaldo(meta, hoy) >= DIAS_RECORDAR_RESPALDO && (!meta.respaldoAvisado || meta.respaldoAvisado === hoy || diasEntre(meta.respaldoAvisado, hoy) >= 3);

/**
 * ¿Ofrecer el recordatorio en el calendario? Una vez, el primer día en que ya hiciste algo (es cuando quieres seguir),
 * mientras no lo hayas descargado ni lo hayas rechazado. Rumbo no puede avisarte sola: el calendario sí.
 */
export const tocaOfrecerRecordatorio = (datos, hoy) =>
  !datos.meta.recordatorioHecho && (!datos.meta.recordatorioVisto || datos.meta.recordatorioVisto === hoy) && (datos.registros.length > 0 || datos.tareas.some((t) => t.hecha));

// ---------- Datos: estructura, migración, validación, import/export ----------

export function datosVacios(hoy) {
  return {
    version: VERSION_DATOS,
    proyectos: [],
    objetivos: [],
    tareas: [],
    registros: [],
    notas: [],
    planes: {},
    bandeja: [],
    foco: { semana: null, objetivos: [] },
    disponibilidad: { plantilla: [...PLANTILLA_POR_DEFECTO], excepciones: {}, ciclo: null },
    meta: { ...metaVacia(), creado: hoy },
  };
}

/** Campos de `meta`: creación, último respaldo, última visita, última revisión semanal y el momento Rumbo. */
const metaVacia = () => ({ creado: null, ultimoRespaldo: null, ultimaVisita: null, ultimaRevision: null, momento: '' });

export function tamanoPorMinutos(m) {
  return m <= 30 ? 'simple' : m <= 120 ? 'media' : 'amplia';
}

/** Objetivo nuevo con todos sus campos (etapa 1, sin etapa anterior). */
export function nuevoObjetivo(campos) {
  return {
    tipo: 'resultado', plazo: null, minutosMeta: null, periodo: null, unidad: '', metaCantidad: null, minutosPorUnidad: null, indicadores: [], logrado: false,
    criterio: '', anteriorId: null, archivado: false, etapa: 1, logradoEl: null, ...campos,
  };
}

/** Tarea nueva con todos sus campos. */
export function nuevaTarea(campos) {
  return { tamano: 'media', minutos: 60, plazo: null, pasos: [], hecha: false, hechaEl: null, tocado: null, noAntesDe: null, esperando: '', ...campos };
}

/** Una tarea en espera (de una respuesta, de un trámite, de una fecha) no se recomienda hasta su fecha `noAntesDe`. */
export const enEspera = (t, hoy) => !t.hecha && !!t.noAntesDe && t.noAntesDe > hoy;

/**
 * Al terminar la última tarea de un objetivo de resultado, queda logrado: así no se celebra
 * y después se pide "planificarlo" con el plazo vencido. Devuelve true si cambió.
 */
export function cerrarSiTerminado(d, objetivoId, fecha = null) {
  const o = d.objetivos.find((x) => x.id === objetivoId);
  if (!o || o.tipo !== 'resultado' || o.logrado) return false;
  const tareas = tareasDe(d, objetivoId);
  if (!tareas.length || tareas.some((t) => !t.hecha)) return false;
  o.logrado = true;
  o.logradoEl = fecha;
  return true;
}

/** Si vuelve a haber algo pendiente (tarea nueva o reabierta), el objetivo deja de estar logrado. */
export function reabrirSiPendiente(d, objetivoId) {
  const o = d.objetivos.find((x) => x.id === objetivoId);
  if (!o || !o.logrado || !tareasDe(d, objetivoId).some((t) => !t.hecha)) return false;
  o.logrado = false;
  o.logradoEl = null;
  return true;
}

/** Tareas a partir de un texto con una tarea por línea (como medias de 1 h, que se ajustan después). */
export function tareasDesdeLineas(texto, objetivoId, hoy, crearId) {
  return String(texto ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((titulo) => nuevaTarea({ id: crearId(), objetivoId, titulo: titulo.slice(0, LIMITES.texto), ...TAREA_RAPIDA, creado: hoy }));
}

/**
 * Lo que quedó "falta algo" en una etapa y no viaja solo a la siguiente
 * (las notas de tareas pendientes viajan con su tarea si se llevan las pendientes).
 */
export function faltantesSueltos(datos, objetivoId, { llevarPendientes = false } = {}) {
  const pendientes = new Set(tareasDe(datos, objetivoId).filter((t) => !t.hecha).map((t) => t.id));
  return faltantesDeObjetivo(datos, objetivoId).filter((n) => !(llevarPendientes && pendientes.has(n.tareaId)));
}

/**
 * Amplía un objetivo: la etapa anterior queda archivada (y lograda) dentro de la nueva, que sigue desde ahí.
 * - `llevarPendientes`: las tareas sin terminar pasan a la nueva etapa, con sus notas.
 * - `faltantesComoTareas` (requiere `crearId`): cada "falta algo" suelto se vuelve una tarea de la nueva etapa
 *   y esa nota queda resuelta, para que nada quede atrapado en la etapa archivada.
 * Modifica `d` y devuelve el nuevo objetivo.
 */
export function ampliarObjetivo(d, anteriorId, nuevo, { llevarPendientes = false, faltantesComoTareas = false, crearId = null, fecha = null } = {}) {
  const anterior = d.objetivos.find((o) => o.id === anteriorId);
  if (!anterior) throw new Error('No existe el objetivo a ampliar.');
  const faltantes = faltantesComoTareas && crearId ? faltantesSueltos(d, anteriorId, { llevarPendientes }) : [];
  anterior.archivado = true;
  if (anterior.tipo === 'resultado' && !anterior.logrado) {
    anterior.logrado = true;
    anterior.logradoEl = fecha;
  }
  const siguiente = nuevoObjetivo({ ...nuevo, proyectoId: anterior.proyectoId, anteriorId, etapa: anterior.etapa + 1 });
  // Los mismos indicadores siguen en la nueva etapa (la anterior conserva lo que anotaste).
  if (!nuevo.indicadores?.length && anterior.indicadores?.length) siguiente.indicadores = anterior.indicadores.map((i) => ({ id: i.id, nombre: i.nombre, eventos: [] }));
  d.objetivos.push(siguiente);
  if (siguiente.tipo === 'resultado') {
    if (llevarPendientes) {
      for (const t of d.tareas.filter((x) => x.objetivoId === anteriorId && !x.hecha)) moverTarea(d, t.id, siguiente.id);
    }
    for (const n of faltantes) {
      d.tareas.push(nuevaTarea({ id: crearId(), objetivoId: siguiente.id, titulo: recortar(n.texto.replace(/\s+/g, ' ').trim(), LIMITES.texto - 1), ...TAREA_RAPIDA, creado: siguiente.creado }));
      n.falta = false;
    }
  }
  return siguiente;
}

/** v1 (proyectos con puntaje y tareas sueltas) → v2: cada proyecto con tareas recibe un objetivo "General". */
function v1a2(d, hoy) {
  const out = { ...datosVacios(hoy), version: 2, plan: { fecha: null, items: [], descartadas: [] } };
  delete out.notas;
  delete out.planes;
  delete out.bandeja;
  delete out.foco;
  const creado = esFechaValida(d.meta?.creado) ? d.meta.creado : hoy;
  if (d.disponibilidad) out.disponibilidad = d.disponibilidad;
  out.meta = { creado, ultimoRespaldo: d.meta?.ultimoRespaldo ?? null };
  for (const p of d.proyectos ?? []) {
    out.proyectos.push({
      id: p.id,
      nombre: p.nombre,
      tipo: p.impacto >= 4 ? 'principal' : 'secundario',
      estado: p.estado === 'pausado' ? 'pausado' : p.estado === 'hecho' ? 'terminado' : 'activo',
      descripcion: p.notas ?? '',
      creado,
    });
    const tareas = (d.tareas ?? []).filter((t) => t.proyectoId === p.id);
    if (!tareas.length) continue;
    const objetivoId = `${p.id}-general`;
    out.objetivos.push({ id: objetivoId, proyectoId: p.id, nombre: 'General', tipo: 'resultado', plazo: p.plazo ?? null, minutosMeta: null, periodo: null, logrado: false, creado });
    for (const t of tareas) {
      out.tareas.push({
        id: t.id, objetivoId, titulo: t.titulo, tamano: tamanoPorMinutos(t.minutos), minutos: t.minutos,
        plazo: t.plazo ?? null, pasos: [], hecha: t.estado === 'hecha', tocado: null, creado,
      });
    }
  }
  return out;
}

/** v2 → v3: plan diario pasa a historial por fecha; objetivos con meta concreta y etapas; notas; fecha de término. */
function v2a3(d) {
  const planes = {};
  if (d.plan && esFechaValida(d.plan.fecha)) planes[d.plan.fecha] = { items: d.plan.items ?? [], descartadas: d.plan.descartadas ?? [] };
  const { plan: _plan, ...resto } = d;
  return {
    ...resto,
    version: 3,
    objetivos: (d.objetivos ?? []).map((o) => ({ criterio: '', anteriorId: null, archivado: false, etapa: 1, ...o })),
    tareas: (d.tareas ?? []).map((t) => ({ hechaEl: t.hecha ? (t.tocado ?? null) : null, ...t })),
    notas: [],
    planes,
  };
}

/**
 * Lleva datos de versiones anteriores a VERSION_DATOS.
 * v0 = sin campo `version` (v0.1 temprana); v1 = v0.1; v2 = centro de proyectos; v3 = etapas, notas e historial;
 * v4 = bandeja "por ordenar", foco semanal, última visita/revisión y momento Rumbo.
 */
export function migrar(obj, hoy) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('El respaldo no tiene el formato de Rumbo.');
  const version = obj.version ?? 0;
  if (!Number.isInteger(version) || version < 0) throw new Error('El campo "version" no es válido.');
  if (version > VERSION_DATOS) throw new Error(`El respaldo es de una versión más nueva (${version}) que esta app (${VERSION_DATOS}).`);
  let d = structuredClone(obj);
  if (version < 2) {
    if (!Array.isArray(d.proyectos) || (d.tareas !== undefined && !Array.isArray(d.tareas))) throw new Error('El respaldo antiguo no trae listas de proyectos y tareas.');
    d = v1a2(d, hoy);
  }
  if (version < 3) d = v2a3(d);
  if (version < 4) d = { ...d, version: 4, bandeja: [], foco: { semana: null, objetivos: [] }, meta: { ...metaVacia(), ...d.meta } };
  return d;
}

const esTexto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const esEntero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const esFechaOpcional = (v) => v === null || v === undefined || esFechaValida(v);
const esId = (v) => esTexto(v, 100);

export function erroresProyecto(p) {
  const e = [];
  if (!esId(p.id)) e.push('id faltante');
  if (!esTexto(p.nombre, LIMITES.texto)) e.push('el nombre está vacío o es muy largo');
  if (!TIPOS_PROYECTO.includes(p.tipo)) e.push('tipo no válido');
  if (!ESTADOS_PROYECTO.includes(p.estado)) e.push('estado no válido');
  if (typeof p.descripcion !== 'string' || p.descripcion.length > LIMITES.descripcion) e.push('descripción muy larga');
  if (p.porQue !== undefined && (typeof p.porQue !== 'string' || p.porQue.length > LIMITES.porQue)) e.push('«por qué te importa» es muy largo');
  if (!esFechaValida(p.creado)) e.push('fecha de creación no válida');
  return e;
}

/** `objetivos` (opcional): Map de objetivos para revisar la etapa anterior. */
export function erroresObjetivo(o, idsProyecto, objetivos = null) {
  const e = [];
  if (!esId(o.id)) e.push('id faltante');
  if (!idsProyecto.has(o.proyectoId)) e.push('proyecto inexistente');
  if (!esTexto(o.nombre, LIMITES.texto)) e.push('el nombre está vacío o es muy largo');
  if (!TIPOS_OBJETIVO.includes(o.tipo)) e.push('tipo no válido');
  if (!esFechaOpcional(o.plazo)) e.push('el plazo no es una fecha válida');
  if (o.tipo === 'tiempo') {
    if (!esEntero(o.minutosMeta, 5, LIMITES.metaMinutos)) e.push('la meta de tiempo debe ser de al menos 5 minutos');
    if (!PERIODOS.includes(o.periodo)) e.push('periodo no válido');
    if (o.unidad !== undefined && o.unidad !== '') {
      if (typeof o.unidad !== 'string' || o.unidad.length > LIMITES.unidad || !o.unidad.trim()) e.push('la unidad no es válida');
      if (!esEntero(o.metaCantidad, 1, LIMITES.cantidad)) e.push('la meta de cantidad debe ser un entero de 1 a 10.000');
      if (!esEntero(o.minutosPorUnidad, 1, 480)) e.push('los minutos por unidad deben ser de 1 a 480');
    }
  } else if (o.unidad) e.push('la unidad solo va en objetivos de tiempo');
  if (o.indicadores !== undefined) {
    const inds = o.indicadores;
    if (!Array.isArray(inds) || inds.length > MAX_INDICADORES) e.push(`máximo ${MAX_INDICADORES} indicadores de resultado`);
    else {
      const ids = new Set();
      for (const ind of inds) {
        const ok = ind && typeof ind === 'object' && esId(ind.id) && !ids.has(ind.id) && esTexto(ind.nombre, LIMITES.indicador) &&
          Array.isArray(ind.eventos) && ind.eventos.length <= LIMITES.eventos &&
          ind.eventos.every((ev) => ev && esFechaValida(ev.fecha) && esEntero(ev.cantidad, 1, LIMITES.cantidad));
        if (!ok) {
          e.push('hay indicadores de resultado no válidos');
          break;
        }
        ids.add(ind.id);
      }
    }
  }
  if (typeof o.logrado !== 'boolean') e.push('logrado no válido');
  if (!esFechaOpcional(o.logradoEl)) e.push('fecha de logro no válida');
  if (typeof o.criterio !== 'string' || o.criterio.length > LIMITES.criterio) e.push('la meta concreta es muy larga');
  if (typeof o.archivado !== 'boolean') e.push('archivado no válido');
  if (!esEntero(o.etapa, 1, LIMITES.etapa)) e.push('etapa no válida');
  if (o.anteriorId !== null) {
    const anterior = objetivos?.get(o.anteriorId);
    if (typeof o.anteriorId !== 'string' || o.anteriorId === o.id || (objetivos && (!anterior || anterior.proyectoId !== o.proyectoId))) e.push('etapa anterior no válida');
  }
  if (!esFechaValida(o.creado)) e.push('fecha de creación no válida');
  return e;
}

export function erroresTarea(t, objetivos) {
  const e = [];
  if (!esId(t.id)) e.push('id faltante');
  const o = objetivos.get(t.objetivoId);
  if (!o) e.push('objetivo inexistente');
  else if (o.tipo !== 'resultado') e.push('las tareas van en objetivos de resultado');
  if (!esTexto(t.titulo, LIMITES.texto)) e.push('el título está vacío o es muy largo');
  if (!Object.hasOwn(TAMANOS, t.tamano)) e.push('tamaño no válido');
  if (!esEntero(t.minutos, 1, LIMITES.minutos)) e.push('los minutos deben ser un entero de 1 a 1440');
  if (!esFechaOpcional(t.plazo)) e.push('el plazo no es una fecha válida');
  if (!Array.isArray(t.pasos) || t.pasos.length > LIMITES.pasos) e.push(`máximo ${LIMITES.pasos} pasos`);
  else if (!t.pasos.every((p) => p && esId(p.id) && esTexto(p.texto, LIMITES.texto) && typeof p.hecho === 'boolean' && esFechaOpcional(p.hechoEl))) e.push('hay pasos no válidos');
  if (typeof t.hecha !== 'boolean') e.push('hecha no válido');
  if (!esFechaOpcional(t.hechaEl)) e.push('fecha de término no válida');
  if (!esFechaOpcional(t.tocado)) e.push('fecha de avance no válida');
  if (!esFechaOpcional(t.noAntesDe)) e.push('la fecha de espera no es válida');
  if (t.esperando !== undefined && (typeof t.esperando !== 'string' || t.esperando.length > LIMITES.esperando)) e.push('lo que esperas es muy largo');
  if (!esFechaValida(t.creado)) e.push('fecha de creación no válida');
  return e;
}

export function erroresNota(n, objetivos, idsTarea) {
  const e = [];
  if (!esId(n.id)) e.push('id faltante');
  if (!esFechaValida(n.fecha)) e.push('fecha no válida');
  if (!esTexto(n.texto, LIMITES.nota)) e.push('la nota está vacía o es muy larga');
  if (!objetivos.has(n.objetivoId)) e.push('objetivo inexistente');
  if (n.tareaId !== null && !idsTarea.has(n.tareaId)) e.push('tarea inexistente');
  if (typeof n.falta !== 'boolean') e.push('"falta algo" no válido');
  return e;
}

/** Valida datos ya migrados. Devuelve lista de errores legibles (vacía si todo está bien). */
export function validarDatos(d) {
  const e = [];
  if (d.version !== VERSION_DATOS) e.push(`versión ${d.version} no soportada`);
  const listas = ['proyectos', 'objetivos', 'tareas', 'registros', 'notas'];
  for (const k of listas) if (!Array.isArray(d[k])) return [...e, `falta la lista de ${k}`];
  for (const k of listas) if (d[k].length > LIMITES[k]) e.push(`más de ${LIMITES[k]} ${k}`);

  const repetidos = (lista, nombre) => {
    const vistos = new Set();
    lista.forEach((x, i) => {
      if (vistos.has(x?.id)) e.push(`${nombre} ${i + 1}: id repetido`);
      vistos.add(x?.id);
    });
  };
  const etiqueta = (x) => String(x?.nombre ?? x?.titulo ?? '?').slice(0, 40);

  repetidos(d.proyectos, 'Proyecto');
  d.proyectos.forEach((p, i) => {
    if (!p || typeof p !== 'object') return e.push(`Proyecto ${i + 1}: no es un objeto`);
    for (const x of erroresProyecto(p)) e.push(`Proyecto ${i + 1} (${etiqueta(p)}): ${x}`);
  });
  const idsProyecto = new Set(d.proyectos.map((p) => p?.id));

  repetidos(d.objetivos, 'Objetivo');
  const objetivos = new Map(d.objetivos.filter((o) => o && typeof o === 'object').map((o) => [o.id, o]));
  d.objetivos.forEach((o, i) => {
    if (!o || typeof o !== 'object') return e.push(`Objetivo ${i + 1}: no es un objeto`);
    for (const x of erroresObjetivo(o, idsProyecto, objetivos)) e.push(`Objetivo ${i + 1} (${etiqueta(o)}): ${x}`);
  });

  repetidos(d.tareas, 'Tarea');
  d.tareas.forEach((t, i) => {
    if (!t || typeof t !== 'object') return e.push(`Tarea ${i + 1}: no es un objeto`);
    for (const x of erroresTarea(t, objetivos)) e.push(`Tarea ${i + 1} (${etiqueta(t)}): ${x}`);
  });
  const idsTarea = new Set(d.tareas.map((t) => t?.id));

  d.registros.forEach((r, i) => {
    if (!r || !esId(r.id) || !esFechaValida(r.fecha) || !esEntero(r.minutos, 1, LIMITES.minutos) || !objetivos.has(r.objetivoId) || (r.tareaId != null && !idsTarea.has(r.tareaId)) || (r.cantidad != null && !esEntero(r.cantidad, 1, LIMITES.cantidad))) {
      e.push(`Registro de tiempo ${i + 1}: no válido`);
    }
  });

  repetidos(d.notas, 'Nota');
  d.notas.forEach((n, i) => {
    if (!n || typeof n !== 'object') return e.push(`Nota ${i + 1}: no es un objeto`);
    for (const x of erroresNota(n, objetivos, idsTarea)) e.push(`Nota ${i + 1}: ${x}`);
  });

  if (!d.planes || typeof d.planes !== 'object' || Array.isArray(d.planes)) {
    e.push('historial de planes no válido');
  } else {
    for (const [fecha, plan] of Object.entries(d.planes)) {
      if (!esFechaValida(fecha) || !plan || !Array.isArray(plan.items) || !Array.isArray(plan.descartadas) || !plan.descartadas.every((x) => typeof x === 'string')) {
        e.push(`Plan del ${fecha.slice(0, 20)}: no válido`);
        continue;
      }
      plan.items.forEach((it, i) => {
        const ok = it && esId(it.id) && ['tarea', 'tiempo', 'planificar'].includes(it.tipo) && objetivos.has(it.objetivoId) && esEntero(it.minutos, 1, LIMITES.minutos) &&
          typeof it.hecho === 'boolean' && (it.tipo !== 'tarea' || idsTarea.has(it.tareaId)) && (it.cantidad == null || esEntero(it.cantidad, 1, LIMITES.cantidad));
        if (!ok) e.push(`Plan del ${fecha}, ítem ${i + 1}: no válido`);
      });
    }
  }

  const disp = d.disponibilidad;
  if (!disp || !Array.isArray(disp.plantilla) || disp.plantilla.length !== 7 || !disp.plantilla.every((m) => esEntero(m, 0, LIMITES.minutos))) {
    e.push('disponibilidad: la plantilla debe tener 7 días con minutos de 0 a 1440');
  }
  if (!disp || typeof disp.excepciones !== 'object' || disp.excepciones === null || Array.isArray(disp.excepciones)) {
    e.push('disponibilidad: excepciones no válidas');
  } else {
    for (const [f, m] of Object.entries(disp.excepciones)) {
      if (!esFechaValida(f) || !esEntero(m, 0, LIMITES.minutos)) e.push(`disponibilidad: excepción ${f.slice(0, 20)} no válida`);
    }
  }
  const ciclo = disp?.ciclo;
  if (ciclo !== undefined && ciclo !== null && (
    typeof ciclo !== 'object' || !esFechaValida(ciclo.inicio) || !esFechaOpcional(ciclo.desde) || !Array.isArray(ciclo.minutos) ||
    ciclo.minutos.length < CICLO_MIN || ciclo.minutos.length > CICLO_MAX || !ciclo.minutos.every((m) => esEntero(m, 0, LIMITES.minutos)) ||
    !Array.isArray(ciclo.nombres) || ciclo.nombres.length !== ciclo.minutos.length || !ciclo.nombres.every((n) => typeof n === 'string' && n.length <= LIMITES.nombreTurno)
  )) {
    e.push('disponibilidad: ciclo de turnos no válido');
  }
  const m = d.meta;
  if (!m || !esFechaOpcional(m.creado) || !esFechaOpcional(m.ultimoRespaldo) || !esFechaOpcional(m.ultimaVisita) || !esFechaOpcional(m.ultimaRevision) ||
    typeof m.momento !== 'string' || m.momento.length > LIMITES.momento) {
    e.push('meta no válida');
  }
  const pp = m?.primerPaso;
  if (pp !== undefined && pp !== null && (typeof pp !== 'object' || !esFechaValida(pp.para) || typeof pp.clave !== 'string' || pp.clave.length > 120)) e.push('el primer paso de mañana no es válido');
  if (m && !esFechaOpcional(m.instalarVisto)) e.push('meta no válida (instalación)');
  if (m && !(esFechaOpcional(m.recordatorioVisto) && esFechaOpcional(m.recordatorioHecho) && esFechaOpcional(m.respaldoAvisado))) e.push('meta no válida (recordatorios)');
  if (!Array.isArray(d.bandeja) || d.bandeja.length > LIMITES.bandeja) e.push('bandeja "por ordenar" no válida');
  else {
    repetidos(d.bandeja, 'Por ordenar');
    d.bandeja.forEach((b, i) => {
      if (!b || !esId(b.id) || !esTexto(b.texto, LIMITES.texto) || !esFechaValida(b.fecha)) e.push(`Por ordenar ${i + 1}: no válido`);
    });
  }
  if (!d.foco || !esFechaOpcional(d.foco.semana) || !Array.isArray(d.foco.objetivos) || !d.foco.objetivos.every((x) => objetivos.has(x))) e.push('foco de la semana no válido');
  return e;
}

export function exportarTexto(datos, hoy) {
  return JSON.stringify({ ...datos, meta: { ...datos.meta, ultimoRespaldo: hoy } }, null, 2);
}

/** Lee un respaldo: parsea, migra y valida. Nunca lanza: devuelve { ok, datos } o { ok: false, errores }. */
export function importarTexto(texto, hoy) {
  let obj;
  try {
    obj = JSON.parse(texto);
  } catch {
    return { ok: false, errores: ['El archivo no es JSON válido (puede estar dañado o incompleto).'] };
  }
  let datos;
  try {
    datos = migrar(obj, hoy);
  } catch (err) {
    return { ok: false, errores: [err.message] };
  }
  const errores = validarDatos(datos);
  return errores.length ? { ok: false, errores } : { ok: true, datos };
}
