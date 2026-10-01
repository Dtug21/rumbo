// app.js — interfaz de Rumbo. Las decisiones (progreso, recomendaciones, validación) viven en logic.js.
import * as L from './logic.js';
import { cargar, guardar, crearId, guardarCopiaPrevia, leerCopiaPrevia, pedirPersistencia } from './store.js';
import { proyectoEjemplo } from './ejemplo.js';
import { PLANTILLAS, aplicarPlantilla } from './plantillas.js';

const $main = document.getElementById('principal');
const $toast = document.getElementById('toast');
const $dialogo = document.getElementById('dialogo');

const hoy = () => L.hoyLocal();
const inicio = cargar(hoy());
let datos = inicio.datos;
let avisoCarga = inicio.aviso;
let errorGuardado = false; // el navegador no dejó guardar el último cambio (lleno o bloqueado)

/** Guarda y, si el navegador se niega, lo deja a la vista: nunca perder cambios en silencio. */
function persistir(d) {
  errorGuardado = !guardar(d);
  return !errorGuardado;
}
if (inicio.nuevo) persistir(datos);
// Con datos que cuidar, se pide al navegador que no los borre por falta de espacio.
if (datos.proyectos.length) pedirPersistencia();
// Regreso: cuántos días pasaron desde la última vez que abriste Rumbo (se anota una vez por día, sin deshacer).
const diasAusente = L.diasFuera(datos.meta, hoy());
let bienvenidaVista = false;
if (datos.meta.ultimaVisita !== hoy()) {
  datos = { ...datos, meta: { ...datos.meta, ultimaVisita: hoy() } };
  persistir(datos);
}
let deshacerTexto = null;
let erroresImportacion = [];
let diaRenderizado = hoy();
let verIgualEl = null; // fecha en que pediste ver recomendaciones aunque no quepan en tu tiempo
const abiertas = new Set(); // tareas y menús "Más" desplegados (se mantienen abiertos al redibujar)

/** Menú "Más": las acciones poco frecuentes quedan plegadas para que la pantalla no se llene de botones. */
function menuMas(clave, etiqueta, botones) {
  return `<details class="mas" data-abierto="${esc(clave)}"${abiertas.has(clave) ? ' open' : ''}>
    <summary aria-label="${esc(etiqueta)}">Más ⋯</summary><div class="mas-menu">${botones.filter(Boolean).join('')}</div></details>`;
}
let ideas = null; // { objetivoId, lista, agregadas: Set }
let ideasObjetivos = null; // { proyectoId, lista, agregadas: Set }

// ---------- Tema día / noche ----------
// Preferencia de este equipo: 'auto' (sigue al sistema), 'claro' u 'oscuro'. El <head> la aplica antes de pintar.
const CLAVE_TEMA = 'rumbo.tema';
const sistemaOscuro = matchMedia('(prefers-color-scheme: dark)');

function leerTema() {
  try {
    const t = localStorage.getItem(CLAVE_TEMA);
    return t === 'claro' || t === 'oscuro' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

const esOscuro = () => {
  const t = document.documentElement.dataset.tema;
  return t ? t === 'oscuro' : sistemaOscuro.matches;
};

function actualizarBotonTema() {
  const b = document.getElementById('tema-boton');
  if (!b) return;
  const oscuro = esOscuro();
  b.dataset.oscuro = String(oscuro);
  b.setAttribute('aria-label', oscuro ? 'Cambiar a modo día' : 'Cambiar a modo noche');
  b.title = oscuro ? 'Cambiar a modo día' : 'Cambiar a modo noche';
  b.querySelector('.tema-texto').textContent = oscuro ? 'Día' : 'Noche';
}

function aplicarTema(tema) {
  if (tema === 'auto') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = tema;
  try {
    if (tema === 'auto') localStorage.removeItem(CLAVE_TEMA);
    else localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin almacenamiento (modo privado): el cambio vale mientras la página esté abierta.
  }
  actualizarBotonTema();
}

sistemaOscuro.addEventListener('change', actualizarBotonTema);

// ---------- Utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const aFecha = (f) => new Date(`${f}T12:00:00Z`);
const fechaLarga = (f) => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(aFecha(f));
const fechaCorta = (f) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(aFecha(f));
const dur = L.formatoDuracion;
const pct = L.porcentaje;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const haceDias = (d) => (d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`);
const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const ETIQUETA_TIPO = { principal: 'Principal', secundario: 'Secundario' };
const ETIQUETA_ESTADO = { activo: 'Activo', pausado: 'Pausado', terminado: 'Terminado' };

const buscar = (lista, id) => lista.find((x) => x.id === id);
const proyectoDeObjetivo = (o) => buscar(datos.proyectos, o.proyectoId);

/** Botón con acción; `data-foco` permite devolverle el foco tras redibujar (uso con teclado). */
function boton(accion, texto, { id = '', clase = 'chico', etiqueta = '', extra = '' } = {}) {
  return `<button type="button" class="${clase}" data-accion="${accion}" data-id="${esc(id)}" data-foco="${accion}:${esc(id)}"${
    etiqueta ? ` aria-label="${esc(etiqueta)}"` : ''
  } ${extra}>${texto}</button>`;
}

function barra(valor, etiqueta, clase = '') {
  const n = Math.round(Math.min(1, Math.max(0, valor)) * 100);
  return `<div class="barra ${clase}${n >= 100 ? ' completa' : ''}" role="progressbar" aria-label="${esc(etiqueta)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}"><span style="width:${n}%"></span></div>`;
}

const chipTamano = (t) => `<span class="chip tamano-${t}">${L.TAMANOS[t].nombre}</span>`;

// ---------- Cambios con deshacer ----------

/**
 * Aplica un cambio con deshacer. Con `celebrar` (id de proyecto), el aviso muestra cuánto subió ese proyecto
 * o celebra el objetivo logrado: ver el avance justo al lograrlo motiva (principio del progreso).
 */
function cambiar(fn, mensaje, { celebrar = null } = {}) {
  const antes = JSON.stringify(datos);
  const previo = datos;
  const copia = structuredClone(datos);
  fn(copia);
  const primerProyecto = !datos.proyectos.length && copia.proyectos.length;
  datos = copia;
  const guardado = persistir(datos);
  deshacerTexto = antes;
  render();
  if (!guardado) return avisar('No pude guardar este cambio en el equipo. Mira el aviso de arriba.', false, 'error');
  if (primerProyecto) pedirPersistencia();
  const logro = celebrar ? L.celebracion(previo, datos, celebrar, hoy()) : null;
  if (logro) avisar(logro.grande ? logro.texto : `${mensaje ? `${mensaje} ` : ''}${logro.texto}`, true, logro.grande ? 'grande' : 'avance');
  else if (mensaje) avisar(mensaje, true);
}

/** Proyecto al que pertenece una tarea u objetivo (para celebrar su avance). */
const proyectoDe = ({ tareaId, objetivoId }) => {
  const o = buscar(datos.objetivos, objetivoId ?? buscar(datos.tareas, tareaId)?.objetivoId);
  return o?.proyectoId ?? null;
};

function deshacer() {
  if (!deshacerTexto) return;
  datos = JSON.parse(deshacerTexto);
  deshacerTexto = null;
  persistir(datos);
  render();
  avisar('Listo, deshecho.');
}

let temporizadorToast;
function avisar(texto, conDeshacer = false, tono = '') {
  const icono = tono === 'grande' ? '<span class="toast-icono" aria-hidden="true">✦</span>' : tono === 'avance' ? '<span class="toast-icono" aria-hidden="true">↑</span>' : '';
  $toast.innerHTML = `${icono}<span>${esc(texto)}</span>${conDeshacer ? boton('deshacer', 'Deshacer') : ''}`;
  $toast.className = `toast${tono ? ` toast-${tono}` : ''}`;
  $toast.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => ($toast.hidden = true), 8000);
}

/** Plan de hoy editable dentro de un cambio. Cada día guarda el suyo en `planes` (historial). */
function planEditable(d) {
  const f = hoy();
  d.planes[f] = structuredClone(L.planDeHoy(d, f));
  return d.planes[f];
}

/**
 * Al borrar tareas u objetivos, se limpian sus referencias en todo el historial (planes, notas y tiempo),
 * para que los datos guardados sigan siendo válidos.
 */
function limpiarReferencias(d, { tareas = new Set(), objetivos = new Set() }) {
  for (const plan of Object.values(d.planes)) {
    plan.items = plan.items.filter((i) => !tareas.has(i.tareaId) && !objetivos.has(i.objetivoId));
  }
  d.notas = d.notas.filter((n) => !tareas.has(n.tareaId) && !objetivos.has(n.objetivoId));
  d.foco.objetivos = d.foco.objetivos.filter((id) => !objetivos.has(id));
  d.registros = d.registros
    .filter((r) => !objetivos.has(r.objetivoId))
    .map((r) => (tareas.has(r.tareaId) ? { ...r, tareaId: null } : r));
}

/**
 * Al terminar una tarea que estaba en el plan de hoy, esa sesión cuenta como hecha y registra sus minutos.
 * Si era la última de su objetivo, el objetivo queda logrado (se celebra y deja de pedir planificarlo).
 */
function marcarTerminada(d, t) {
  const f = hoy();
  t.hecha = true;
  t.hechaEl = f;
  t.tocado = f;
  const plan = L.planDeHoy(d, f);
  const item = plan.items.find((i) => i.tareaId === t.id && !i.hecho);
  if (item) completarItem(d, item.id, item.minutos);
  L.cerrarSiTerminado(d, t.objetivoId, f);
}

function completarItem(d, itemId, minutos) {
  const f = hoy();
  const plan = planEditable(d);
  const item = plan.items.find((i) => i.id === itemId);
  item.hecho = true;
  item.minutos = minutos;
  d.registros.push({ id: crearId(), fecha: f, minutos, objetivoId: item.objetivoId, tareaId: item.tareaId ?? null });
  if (item.tareaId) buscar(d.tareas, item.tareaId).tocado = f;
}

// ---------- Rutas ----------

function rutaActual() {
  const [, nombre = 'hoy', id = ''] = location.hash.split('/');
  return { nombre: ['hoy', 'dia', 'proyectos', 'proyecto', 'ajustes', 'guia'].includes(nombre) ? nombre : 'hoy', id: decodeURIComponent(id) };
}

function render() {
  const foco = document.activeElement?.dataset?.foco;
  const ruta = rutaActual();
  diaRenderizado = hoy();
  const vistas = { hoy: vistaHoy, dia: vistaDiaPasado, proyectos: vistaProyectos, proyecto: vistaProyecto, ajustes: vistaAjustes, guia: vistaGuia };
  const sinGuardar = errorGuardado
    ? `<div class="aviso error-guardado" role="alert"><p><strong>No pude guardar tus últimos cambios en este equipo.</strong> El almacenamiento del navegador está lleno o bloqueado. Lo que hiciste sigue aquí mientras no cierres esta página: descarga un respaldo ahora.</p>
        <div class="fila-botones">${boton('exportar', 'Descargar respaldo', { clase: 'chico primario' })}${boton('reintentar-guardar', 'Reintentar guardar')}</div></div>`
    : '';
  $main.innerHTML =
    sinGuardar + (avisoCarga ? `<div class="aviso" role="alert"><p>${esc(avisoCarga)}</p>${boton('cerrar-aviso', 'Entendido')}</div>` : '') + vistas[ruta.nombre](ruta.id);
  const seccion = { proyecto: 'proyectos' }[ruta.nombre] ?? ruta.nombre;
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.ruta === seccion) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const nombres = { hoy: 'Mi día', dia: 'Historial', proyectos: 'Proyectos', proyecto: 'Proyectos', ajustes: 'Ajustes', guia: 'Guía' };
  const proyecto = ruta.nombre === 'proyecto' ? buscar(datos.proyectos, ruta.id) : null;
  document.getElementById('miga').textContent = ['Mi espacio', nombres[ruta.nombre], proyecto?.nombre].filter(Boolean).join('   /   ');
  document.getElementById('fecha-top').textContent = fechaLarga(hoy());
  document.title = `${proyecto?.nombre ?? nombres[ruta.nombre]} · Rumbo`;
  if (foco) $main.querySelector(`[data-foco="${CSS.escape(foco)}"]`)?.focus();
  seguirTutorial();
  pintarTutorial();
}

// ---------- Bienvenida ----------

/** Íconos de línea (24×24) usados en la interfaz. */
const ICONOS = {
  chispa: '<path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  llama: '<path d="M12 21.5c-3.9 0-6.8-2.7-6.8-6.4 0-3.3 2.3-5.4 3.9-7.6.3 1.9 1.4 3 2.4 3.4.2-3 1.6-5.2 2.4-6.9 2.8 2.2 5.7 5.9 5.7 11.1 0 3.7-3.1 6.4-7.6 6.4z"/>',
  carpeta: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H9l2 2h6.5A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/>',
  lista: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M4 6.5l1.2 1.2L7.5 5.4M4 12l1.2 1.2 2.3-2.3M4 17.5l1.2 1.2 2.3-2.3"/>',
  reloj: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.3 1.7M10 2.5h4"/>',
  bandera: '<path d="M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11"/>',
  flecha: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icono = (nombre, clase = '') => `<svg class="${clase}" aria-hidden="true" viewBox="0 0 24 24">${ICONOS[nombre]}</svg>`;

function bienvenida() {
  return `
    <p class="ceja">Bienvenido a Rumbo</p>
    <div class="cabecera-grande"><div><h1 class="titular">Tu centro de proyectos</h1>
      <p class="bajada">Qué hacer hoy, y por qué. Todo con su barra de progreso.</p></div></div>
    <section class="heroe bienvenida">
      <span class="insignia">${icono('chispa')} Cómo funciona</span>
      <h2 class="heroe-titulo">Cada proyecto se arma en 4 niveles.</h2>
      <ol class="niveles">
        <li><strong>Proyecto</strong>: principal o secundario.</li>
        <li><strong>Objetivos</strong>: lograr algo concreto, o dedicarle tiempo (por ejemplo, estudiar 3 h por semana).</li>
        <li><strong>Tareas</strong>: simples, medias o amplias.</li>
        <li><strong>Pasos</strong>: lo que marcas para ver avanzar cada tarea.</li>
      </ol>
      <p class="heroe-texto">Cada día, en <strong>Mi día</strong>, Rumbo te recomienda qué hacer según tu tiempo libre.</p>
      <div class="fila-botones">
        ${boton('nuevo-proyecto', `${icono('mas')} Crear mi primer proyecto`, { clase: 'boton-claro', etiqueta: 'Crear mi primer proyecto' })}
        ${boton('ver-plantillas', `${icono('chispa')} Empezar desde una idea`, { clase: 'boton-contorno', etiqueta: 'Empezar desde una idea' })}
        ${boton('cargar-ejemplo', 'Ver un ejemplo', { clase: 'boton-contorno' })}
      </div>
      <p class="heroe-texto bienvenida-duda">¿No sabes si algo es proyecto, objetivo o tarea? ${boton('clasificar', '¿Qué es esto?', { clase: 'boton-contorno chico' })}</p>
    </section>`;
}

// ---------- HOY ----------

const nombreDe = (x) => (x.tipo === 'tarea' ? x.tarea.titulo : x.objetivo.nombre);

/** "1 h 10 min trabajados de 4 h" y, si ya se pasó de lo estimado, el aviso para terminar o ajustar. */
function tiempoTrabajado(t) {
  const trabajado = L.minutosTrabajados(datos, t.id);
  if (!trabajado) return '';
  return `<span>${dur(trabajado)} trabajados de ${dur(t.minutos)}</span>`;
}

function avisoExcedida(t) {
  if (!L.excedida(t, datos)) return '';
  return `<div class="aviso"><p>Llevas ${dur(L.minutosTrabajados(datos, t.id))} en esta tarea y estimaste ${dur(t.minutos)}. ¿La terminas o ajustas la estimación?</p>
    <div class="fila-botones">${boton('terminar-tarea', 'Terminarla', { id: t.id, clase: 'chico primario', etiqueta: `Terminar: ${t.titulo}` })}${boton('editar-tarea', 'Ajustar estimación', { id: t.id, etiqueta: `Ajustar estimación: ${t.titulo}` })}</div></div>`;
}

/** Notas escritas ese día sobre lo trabajado en un ítem del plan. */
const notasDeItem = (i, fecha) =>
  datos.notas.filter((n) => n.fecha === fecha && (i.tareaId ? n.tareaId === i.tareaId : n.objetivoId === i.objetivoId && !n.tareaId));

function notasItemHtml(i, fecha) {
  return `${notasHtml(notasDeItem(i, fecha), { conFecha: false })}
    <div class="fila-botones">${boton('nota-item', i.hecho ? '+ Nota: ¿cómo te fue?' : '+ Nota', { id: `${fecha}|${i.id}`, clase: 'chico plano', etiqueta: `Agregar nota a ${nombreDe(i)}` })}</div>`;
}

function itemHtml(i) {
  const cerrado = i.hecho ? ' hecho' : '';
  const notas = notasItemHtml(i, hoy());
  const quitar = boton('item-quitar', 'Quitar', { id: i.id, clase: 'chico plano', etiqueta: `Quitar del plan: ${nombreDe(i)}` });
  const sesionHecha = i.hecho ? '<span class="chip en-plan">Sesión hecha</span>' : '';

  if (i.tipo === 'tiempo') {
    const prog = L.progresoObjetivo(i.objetivo, datos, hoy());
    const periodo = i.objetivo.periodo === 'semana' ? 'esta semana' : 'en total';
    return `<li class="item${cerrado}">
      <div class="item-cabeza"><h3>${esc(i.objetivo.nombre)}: ${dur(i.minutos)}</h3><span class="pct">${pct(prog.valor)}</span></div>
      <div class="meta"><span>${esc(i.proyecto.nombre)}</span><span class="chip">${L.esRitmoSemanal(i.objetivo) ? 'Ritmo semanal' : 'Tiempo'}</span>${sesionHecha}</div>
      ${barra(prog.valor, `Avance de ${i.objetivo.nombre}`)}
      <p class="ayuda">${dur(prog.minutos)} de ${dur(prog.meta)} ${periodo}</p>
      ${i.hecho ? '' : `<div class="fila-botones">
        ${boton('item-hecho', `Hecho: registrar ${dur(i.minutos)}`, { id: i.id, clase: 'chico primario' })}
        ${boton('item-cantidad', 'Hice otra cantidad', { id: i.id })}
        ${quitar}
      </div>`}
      ${notas}
    </li>`;
  }

  if (i.tipo === 'planificar') {
    const o = i.objetivo;
    const tareas = L.tareasDe(datos, o.id);
    const pendientes = tareas.filter((t) => !t.hecha).length;
    return `<li class="item${cerrado}">
      <div class="item-cabeza"><h3>Planifica "${esc(o.nombre)}"</h3></div>
      <div class="meta"><span>${esc(i.proyecto.nombre)}</span><span class="chip">Planificar</span><span>${dur(i.minutos)}</span>${sesionHecha}</div>
      <p class="ayuda">${pendientes ? `Ya tiene ${plural(pendientes, 'tarea pendiente', 'tareas pendientes')}: aparecerán en tus recomendaciones.` : 'Define sus próximas tareas: tú o con ideas de Claude.'}</p>
      ${i.hecho ? '' : `<div class="fila-botones">
        ${boton('ideas', 'Pedir ideas a Claude', { id: o.id, clase: 'chico primario' })}
        ${boton('nueva-tarea', '+ Tarea', { id: o.id, etiqueta: `Nueva tarea en ${o.nombre}` })}
        ${tareas.length && !pendientes ? boton('logrado', 'Marcar logrado', { id: o.id }) : ''}
        ${boton('item-hecho', 'Listo', { id: i.id, etiqueta: `Listo: planificar ${o.nombre}` })}
        ${quitar}
      </div>`}
      ${notas}
    </li>`;
  }

  const t = i.tarea;
  const prog = L.progresoTarea(t, datos);
  let botones;
  if (i.hecho) botones = `<p class="ayuda">Registraste ${dur(i.minutos)}${t.hecha ? ' y la tarea está terminada' : ''}.</p>`;
  else if (t.tamano === 'simple') {
    botones = `<div class="fila-botones">${boton('terminar-tarea', `Hecha: registrar ${dur(i.minutos)}`, { id: t.id, clase: 'chico primario', etiqueta: `Hecha: ${t.titulo}` })}${quitar}</div>`;
  } else {
    botones = `<div class="fila-botones">
      ${boton('item-hecho', `Listo por hoy: registrar ${dur(i.minutos)}`, { id: i.id, clase: 'chico primario' })}
      ${boton('item-cantidad', 'Hice otra cantidad', { id: i.id })}
      ${t.hecha ? '' : boton('terminar-tarea', 'Terminar tarea', { id: t.id })}
      ${quitar}
    </div>`;
  }
  return `<li class="item${cerrado}">
    <div class="item-cabeza"><h3>${t.hecha ? '✓ ' : ''}${esc(t.titulo)}</h3><span class="pct">${pct(prog)}</span></div>
    <div class="meta"><span>${esc(i.proyecto.nombre)} · ${esc(i.objetivo.nombre)}</span>${chipTamano(t.tamano)}<span>sesión de ${dur(i.minutos)}</span>${sesionHecha}</div>
    ${barra(prog, `Avance de ${t.titulo}`)}
    ${t.pasos.length ? pasosHtml(t) : ''}
    ${L.avanzaPorTiempo(t) ? `<p class="meta">${tiempoTrabajado(t) || '<span>Sin pasos: la barra avanza con el tiempo que registres (hasta 90%).</span>'}</p>` : ''}
    ${i.hecho ? '' : avisoExcedida(t)}
    ${botones}
    ${notas}
  </li>`;
}

/** Título de un ítem del plan, para el historial. */
function tituloItem(i) {
  if (i.tipo === 'tiempo') return `${esc(i.objetivo.nombre)}: ${dur(i.minutos)}`;
  if (i.tipo === 'planificar') return `Planifica "${esc(i.objetivo.nombre)}"`;
  return esc(i.tarea.titulo);
}

function itemPasadoHtml(i, fecha) {
  return `<li class="item${i.hecho ? ' hecho' : ''}">
    <div class="item-cabeza"><h3>${tituloItem(i)}</h3></div>
    <div class="meta"><span>${esc(i.proyecto.nombre)}${i.tipo === 'tarea' ? ` · ${esc(i.objetivo.nombre)}` : ''}</span>${
      i.hecho ? `<span class="chip en-plan">Hecho · ${dur(i.minutos)}</span>` : '<span class="chip">No se hizo</span>'
    }</div>
    ${notasItemHtml(i, fecha)}
  </li>`;
}

/** Tu semana en 7 barras (minutos por día, hasta hoy). Cada barra lleva a ese día; la del día que miras se destaca. */
function semanaHtml(fechaActual) {
  const f = hoy();
  const r = L.resumenSemana(datos, f);
  const max = Math.max(1, ...r.minutosPorDia.map((x) => x.minutos));
  return `<section class="tarjeta semana" aria-labelledby="semana-titulo">
    <div class="item-cabeza"><h2 id="semana-titulo" class="titulo-tarjeta">Tus últimos 7 días</h2><span class="pct">${dur(r.minutos)}</span></div>
    ${r.minutos ? '' : '<p class="ayuda">Aún no registras minutos estos 7 días. Cada sesión que marques aparece aquí como una barra.</p>'}
    <div class="semana-barras${r.minutos ? '' : ' vacia'}">${r.minutosPorDia
      .map((x) => {
        const destino = x.fecha === f ? '#/hoy' : `#/dia/${x.fecha}`;
        const nombre = NOMBRES_DIA[L.diaSemana(x.fecha)];
        return `<a class="dia-barra${x.fecha === fechaActual ? ' actual' : ''}" href="${destino}" aria-label="${esc(`${nombre} ${fechaCorta(x.fecha)}: ${dur(x.minutos)}`)}">
          <span class="dia-barra-valor" style="height:${Math.round((x.minutos / max) * 100)}%"></span><span class="dia-barra-etiqueta">${nombre.slice(0, 2)}</span></a>`;
      })
      .join('')}</div>
    <div class="fila-botones">${boton('revision', 'Revisar mi semana', { clase: 'chico' })}</div>
  </section>`;
}

/** Historial: lo que planificaste, hiciste y anotaste un día anterior. Las notas se pueden seguir agregando. */
function vistaDiaPasado(fecha) {
  const f = hoy();
  if (!fecha) fecha = L.sumarDias(f, -1); // "Historial" en el menú abre ayer
  if (!L.esFechaValida(fecha) || fecha >= f) return vistaHoy();
  const v = L.vistaDia(datos, fecha);
  const siguiente = L.sumarDias(fecha, 1);
  const mostradas = new Set(v.items.flatMap((i) => notasDeItem(i, fecha).map((n) => n.id)));
  const otrasNotas = v.notas.filter((x) => !mostradas.has(x.nota.id));
  const hechos = v.items.filter((i) => i.hecho).length;
  const titulo = fechaLarga(fecha);
  const vacio = !v.items.length && !v.minutos && !v.terminadas.length && !v.notas.length;
  return `
    <p class="ceja">Historial · ${haceDias(L.diasEntre(fecha, f))}</p>
    <div class="cabecera-grande"><div><h1 class="titular">${esc(titulo[0].toUpperCase() + titulo.slice(1))}</h1><p class="bajada">Lo que planificaste, hiciste y anotaste ese día.</p></div></div>
    <nav class="navegar-dias" aria-label="Días">
      <a class="boton chico" href="#/dia/${L.sumarDias(fecha, -1)}">‹ Día anterior</a>
      <a class="boton chico" href="${siguiente === f ? '#/hoy' : `#/dia/${siguiente}`}">${siguiente === f ? 'Hoy' : 'Día siguiente'} ›</a>
    </nav>
    ${semanaHtml(fecha)}
    ${vacio ? '<p class="vacio">Ese día no registraste nada.</p>' : `
    <section class="tarjeta dia">
      <p><strong>${dur(v.minutos)}</strong> registrados${v.items.length ? ` · ${hechos} de ${plural(v.items.length, 'ítem del plan hecho', 'ítems del plan hechos')}` : ''}${v.terminadas.length ? ` · ${plural(v.terminadas.length, 'tarea terminada', 'tareas terminadas')}` : ''}</p>
    </section>
    ${v.items.length ? `<h2>Tu plan de ese día</h2><ul class="lista">${v.items.map((i) => itemPasadoHtml(i, fecha)).join('')}</ul>` : ''}
    ${v.terminadas.length ? `<h2>Terminaste</h2><ul class="lista-simple">${v.terminadas.map((x) => `<li>✓ ${esc(x.tarea.titulo)} <span class="ayuda">· ${esc(x.proyecto?.nombre ?? '')} · ${esc(x.objetivo?.nombre ?? '')}</span></li>`).join('')}</ul>` : ''}
    ${otrasNotas.length ? `<h2>Otras notas de ese día</h2>${otrasNotas.map((x) => `<p class="ayuda donde-nota">${esc(x.proyecto?.nombre ?? '')} · ${esc(x.tarea?.titulo ?? x.objetivo?.nombre ?? '')}</p>${notasHtml([x.nota], { conFecha: false })}`).join('')}` : ''}`}
  `;
}

/** Título (ya escapado) de una recomendación. */
function tituloRec(r) {
  if (r.tipo === 'tiempo') return `Dedica ${dur(r.minutos)} a ${esc(r.objetivo.nombre)}`;
  if (r.tipo === 'planificar') return `Planifica "${esc(r.objetivo.nombre)}": define sus próximas tareas`;
  return esc(r.tarea.titulo);
}

/** Si el plazo venció: decidir en un toque (moverlo, quitarlo o darlo por hecho) en vez de arrastrarlo cada día. */
function vencidoHtml(r, { claro = false } = {}) {
  if (!r.vencido) return '';
  const v = r.vencido;
  const clase = claro ? 'chico boton-contorno' : 'chico';
  const de = v.tipo === 'objetivo' ? `del objetivo "${esc(r.objetivo.nombre)}"` : 'de esta tarea';
  return `<div class="${claro ? 'vencido-claro' : 'aviso vencido'}"><p>El plazo ${de} venció el ${esc(fechaCorta(v.fecha))}. ¿Qué hacemos?</p>
    <div class="fila-botones">
      ${boton('mover-plazo', 'Mover plazo', { id: `${v.tipo}|${v.id}`, clase, etiqueta: `Mover plazo: ${nombreDe(r)}` })}
      ${boton('quitar-plazo', 'Quitar plazo', { id: `${v.tipo}|${v.id}`, clase, etiqueta: `Quitar plazo: ${nombreDe(r)}` })}
      ${r.tarea ? boton('terminar-tarea', 'Ya lo hice', { id: r.tarea.id, clase, etiqueta: `Ya lo hice: ${r.tarea.titulo}` }) : ''}
    </div></div>`;
}

function recomendacionHtml(r) {
  const titulo = tituloRec(r);
  let chip;
  let prog;
  if (r.tipo === 'tiempo') {
    chip = `<span class="chip">${L.esRitmoSemanal(r.objetivo) ? 'Ritmo semanal' : 'Tiempo'}</span>`;
    prog = L.progresoObjetivo(r.objetivo, datos, hoy()).valor;
  } else if (r.tipo === 'planificar') {
    chip = `<span class="chip">Planificar</span><span>${dur(r.minutos)}</span>`;
    prog = L.progresoObjetivo(r.objetivo, datos, hoy()).valor;
  } else {
    chip = `${chipTamano(r.tarea.tamano)}<span>${dur(r.minutos)}</span>`;
    prog = L.progresoTarea(r.tarea, datos);
  }
  return `<li class="rec">
    <div class="item-cabeza"><h3>${titulo}</h3><span class="pct">${pct(prog)}</span></div>
    <div class="meta"><span>${esc(r.proyecto.nombre)}${r.tipo === 'tarea' ? ` · ${esc(r.objetivo.nombre)}` : ''}</span>${chip}</div>
    ${barra(prog, `Avance actual de ${nombreDe(r)}`)}
    <p class="porque"><strong>Por qué:</strong> ${r.motivos.map(esc).join(' · ')}${r.acortada ? ' · Acortada para caber en tu tiempo' : ''}.</p>
    ${vencidoHtml(r)}
    <div class="fila-botones">
      ${boton('aceptar', 'Aceptar', { id: r.clave, clase: 'chico primario', etiqueta: `Aceptar: ${nombreDe(r)}` })}
      ${boton('otra', 'Otra', { id: r.clave, etiqueta: `Mostrar otra en vez de: ${nombreDe(r)}` })}
    </div>
  </li>`;
}

/** Ideas sueltas anotadas rápido que aún no tienen objetivo. */
function bandejaHtml() {
  if (!datos.bandeja.length) return '';
  return `<section class="tarjeta bandeja" aria-labelledby="bandeja-titulo">
    <div class="item-cabeza"><h2 id="bandeja-titulo" class="titulo-tarjeta">Por ordenar (${datos.bandeja.length})</h2>${icono('bandera', 'icono-suave')}</div>
    <p class="ayuda">Lo que anotaste rápido. Dale un objetivo para que entre a tus recomendaciones, o descártalo. Si no sabes qué es, toca «¿Qué es?».</p>
    <ul class="lista-bandeja">${datos.bandeja
      .map((b) => `<li><span>${esc(b.texto)}</span><span class="acciones-nota">
        ${boton('ordenar', 'Ordenar', { id: b.id, clase: 'chico primario', etiqueta: `Ordenar: ${b.texto}` })}
        ${boton('clasificar-bandeja', '¿Qué es?', { id: b.id, etiqueta: `¿Qué es?: ${b.texto}` })}
        ${boton('descartar-bandeja', '×', { id: b.id, clase: 'chico plano', etiqueta: `Descartar: ${b.texto}` })}</span></li>`)
      .join('')}</ul>
  </section>`;
}

/** En la tarjeta verde: marcar lo pendiente sin bajar hasta el plan (en el teléfono queda a 2 pantallas). */
function botonesPendiente(i) {
  const nombre = nombreDe(i);
  const verPlan = boton('ir-a', 'Ver mi plan', { id: 'plan', clase: 'boton-contorno', etiqueta: 'Ir a mi plan de hoy' });
  if (i.tipo === 'planificar') return boton('ir-a', `${icono('play')} Ir a mi plan`, { id: 'plan', clase: 'boton-claro', etiqueta: 'Ir a mi plan de hoy' });
  if (i.tipo === 'tarea' && i.tarea.tamano === 'simple') {
    return `${boton('terminar-tarea', `${icono('play')} Hecha: registrar ${dur(i.minutos)}`, { id: i.tarea.id, clase: 'boton-claro', etiqueta: `Marcar hecha ahora: ${nombre}` })}${verPlan}`;
  }
  return `${boton('item-hecho', `${icono('play')} ${i.tipo === 'tiempo' ? 'Hecho' : 'Listo por hoy'}: registrar ${dur(i.minutos)}`, { id: i.id, clase: 'boton-claro', etiqueta: `Marcar listo ahora: ${nombre}` })}
    ${boton('item-cantidad', 'Otra cantidad', { id: i.id, clase: 'boton-contorno', etiqueta: `Otra cantidad ahora: ${nombre}` })}${verPlan}`;
}

/** Chip y explicación del riesgo de plazo de un objetivo (null si no aplica). Todo en % del objetivo, por semana. */
function riesgoHtml(o) {
  const r = L.riesgoPlazo(o, datos, hoy());
  if (!r) return '';
  const cuanto = (x) => `${Math.max(1, Math.round(x * 100))}%`;
  if (r.estado === 'vencido') return `<p class="riesgo vencido"><span class="chip riesgo-chip">Plazo vencido</span> Falta ${cuanto(r.falta)}. Mueve el plazo o decide cómo seguir.</p>`;
  if (r.estado === 'sin-ritmo') return `<p class="riesgo"><span class="chip">Recién empieza</span> Faltan ${plural(r.dias, 'día', 'días')}. Para llegar, ${r.necesario >= 1 ? 'tendrías que terminarlo todo en estos días' : `necesitas avanzar ~${cuanto(r.necesario)} por semana`}.</p>`;
  if (r.estado === 'en-ritmo') return `<p class="riesgo ok"><span class="chip riesgo-chip">Vas en ritmo</span> Avanzaste ${cuanto(r.lleva)} esta semana y necesitas ~${cuanto(r.necesario)} para llegar (${plural(r.dias, 'día', 'días')}).</p>`;
  return `<p class="riesgo riesgo-alto"><span class="chip riesgo-chip">En riesgo</span> Faltan ${plural(r.dias, 'día', 'días')} y falta ${cuanto(r.falta)}: ${r.necesario >= 1 ? 'tendrías que terminarlo todo en estos días' : `necesitas avanzar ~${cuanto(r.necesario)} por semana`} y esta semana llevas ${r.lleva ? cuanto(r.lleva) : '0%'}. Acepta algo de este objetivo hoy o mueve el plazo.</p>`;
}

/** "Para: <meta>" — recordar para qué sirve lo que vas a hacer ayuda a empezar. */
const paraQue = (o) => (o?.criterio ? `<span class="para-que">Para: ${esc(o.criterio)}</span>` : '');

function vistaHoy() {
  const f = hoy();
  if (!datos.proyectos.length) return bienvenida();
  const v = L.vistaHoy(datos, f, { ignorarCapacidad: verIgualEl === f });
  const respaldo = L.tocaRecordarRespaldo(datos.meta, f)
    ? `<div class="aviso"><p>${datos.meta.ultimoRespaldo ? `Hace ${L.diasSinRespaldo(datos.meta, f)} días que no respaldas.` : 'Todavía no has hecho un respaldo.'} Tus datos viven solo en este navegador.</p>${boton('exportar', 'Descargar respaldo ahora', { clase: 'chico primario' })}</div>`
    : '';

  // Regreso después de varios días: sin culpa, y arriba lo más corto para volver a arrancar.
  const regreso = diasAusente >= L.DIAS_PARA_BIENVENIDA && !bienvenidaVista;
  const recs = regreso ? [...v.recomendaciones].sort((a, b) => a.minutos - b.minutos) : v.recomendaciones;
  const pendiente = v.items.find((i) => !i.hecho);
  const [principal, ...otras] = recs;

  // Tarjeta verde "Tu próximo paso": lo pendiente del plan, o la mejor recomendación, o el estado del día.
  let heroe;
  if (pendiente) {
    heroe = {
      paso: 2,
      titulo: tituloItem(pendiente),
      texto: `${paraQue(pendiente.objetivo)}${esc(pendiente.proyecto.nombre)} · sesión de ${dur(pendiente.minutos)}. Ya está en tu plan de hoy: cuando termines, márcalo aquí mismo.`,
      botones: botonesPendiente(pendiente),
    };
  } else if (principal) {
    heroe = {
      paso: 1,
      titulo: tituloRec(principal),
      texto: `${paraQue(principal.objetivo)}<strong>Por qué:</strong> ${principal.motivos.slice(0, 2).map(esc).join(' · ')}.<span class="heroe-meta">${esc(principal.proyecto.nombre)} · ${dur(principal.minutos)}${principal.acortada ? ' · acortada para caber en tu tiempo' : ''}</span>`,
      extra: vencidoHtml(principal, { claro: true }),
      botones: `${boton('aceptar', `${icono('play')} Aceptar`, { id: principal.clave, clase: 'boton-claro', etiqueta: `Aceptar: ${nombreDe(principal)}` })}
        ${boton('otra', 'Otra', { id: principal.clave, clase: 'boton-contorno', etiqueta: `Mostrar otra en vez de: ${nombreDe(principal)}` })}`,
    };
  } else if (!v.hayMas) {
    heroe = {
      paso: 3,
      titulo: v.items.length ? 'Vas al día. Buen trabajo.' : 'Por hoy vas al día.',
      texto: 'No tengo más que recomendarte. Para avanzar más, agrega tareas u objetivos en tus proyectos, o anota cómo te fue.',
      botones: `<a class="boton boton-claro" href="#/proyectos">${icono('carpeta')} Ir a mis proyectos</a>`,
    };
  } else {
    let motivo;
    if (v.libres === 0) motivo = 'Hoy marcaste que no tienes tiempo libre. Descansa: mañana sigue.';
    else if (v.disponibles <= 0) motivo = `Ya llenaste tu tiempo de hoy (${dur(v.capacidad)}).`;
    else motivo = `Lo pendiente no cabe en los ${dur(v.disponibles)} que te quedan.`;
    heroe = { paso: v.items.length ? 3 : 1, titulo: v.items.length ? 'Tu día está completo.' : 'Hoy toca pausa.', texto: motivo, botones: boton('ver-igual', 'Recomendarme igual', { clase: 'boton-claro' }) };
  }
  const pasos = ['Elegir', 'Hacer', 'Anotar']
    .map((p, i) => `<li class="${i + 1 === heroe.paso ? 'actual' : ''}"${i + 1 === heroe.paso ? ' aria-current="step"' : ''}><b>0${i + 1}</b> ${p}</li>`)
    .join('');

  // Anillo "Tu objetivo de hoy": minutos hechos sobre lo planificado (o sobre la capacidad, si aún no hay plan).
  const meta = v.minutosPlaneados || v.capacidad;
  const fraccion = meta ? Math.min(1, v.minutosHechos / meta) : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  let frase;
  if (!v.minutosHechos) frase = 'Cada minuto cuenta: parte por el primer paso.';
  else if (v.minutosHechos >= meta) frase = 'Cumpliste lo que planificaste hoy.';
  else frase = `Te faltan ${dur(meta - v.minutosHechos)}. Vas bien.`;

  // Solo números que llevan a algo: tu semana (historial) y lo anotado que falta (lista para resolver).
  const semana7 = L.resumenSemana(datos, f); // últimos 7 días: días con avance y minutos (pequeños logros)
  const faltantes = datos.notas.filter((n) => n.falta).length;
  const stat = (ic, num, texto, accion, etiqueta) =>
    `<button type="button" class="stat" data-accion="${accion}" data-foco="${accion}:" aria-label="${esc(etiqueta)}"><span class="stat-icono">${icono(ic)}</span><span><span class="stat-num">${num}</span><span class="stat-texto">${texto}</span></span></button>`;

  const listaRecs = principal && !pendiente ? otras : recs;
  const cicloHoy = datos.disponibilidad.excepciones[f] === undefined ? L.diaDelCiclo(datos.disponibilidad, f) : null;
  const momento = datos.meta.momento
    ? `<p class="momento">${icono('reloj')} Tu momento Rumbo: <strong>${esc(datos.meta.momento)}</strong> ${boton('momento', 'Cambiar', { clase: 'chico plano', etiqueta: 'Cambiar mi momento Rumbo' })}</p>`
    : `<p class="momento">${icono('reloj')} ¿Cuándo abrirás Rumbo cada día? ${boton('momento', 'Elegir mi momento Rumbo', { clase: 'chico plano' })}</p>`;

  return `
    <p class="ceja">Tu rumbo de hoy</p>
    <div class="cabecera-grande"><div><h1 class="titular">Un paso más cerca, cada día.</h1>
      <p class="bajada">${esc(fechaLarga(f))}. Qué hacer hoy, y por qué.</p>${L.nuevoComienzo(f, diasAusente) ? `<p class="nuevo-comienzo">${esc(L.nuevoComienzo(f, diasAusente))}</p>` : ''}${momento}</div>
      <div class="fila-botones">${boton('anotar', `${icono('mas')} Anotar rápido`, { clase: 'primario', etiqueta: 'Anotar rápido' })}${boton('registrar-tiempo', `${icono('reloj')} Registrar tiempo`, { clase: '', etiqueta: 'Registrar tiempo' })}<a class="boton" href="#/dia/${L.sumarDias(f, -1)}">‹ Días anteriores</a></div></div>
    ${respaldo}
    ${regreso ? `<div class="aviso regreso" role="status"><p><strong>Qué bueno verte de vuelta.</strong> Pasaron ${diasAusente} días: no hay deuda que pagar. Arriba te dejo lo más corto para volver a arrancar.</p>${boton('cerrar-regreso', 'Gracias', { clase: 'chico' })}</div>` : ''}
    ${L.tocaRevisionSemanal(datos.meta, f) ? `<div class="aviso revision"><p><strong>Es ${L.diaSemana(f) === 0 ? 'domingo' : 'lunes'}: revisa tu semana.</strong> 5 minutos para ver lo logrado, decidir qué hacer con lo vencido y elegir tu foco.</p>${boton('revision', 'Revisar mi semana', { clase: 'chico primario' })}</div>` : ''}
    <div class="rejilla-hoy">
      <section class="heroe" aria-labelledby="heroe-titulo">
        <span class="insignia">${icono('chispa')} Tu próximo paso</span>
        <h2 class="heroe-titulo" id="heroe-titulo">${heroe.titulo}</h2>
        <p class="heroe-texto">${heroe.texto}</p>
        ${heroe.extra ?? ''}
        <div class="fila-botones">${heroe.botones}</div>
        <ol class="heroe-pasos" aria-label="Tu día en 3 pasos">${pasos}</ol>
      </section>
      <section class="tarjeta anillo-tarjeta dia" aria-labelledby="dia-titulo">
        <div class="item-cabeza"><h2 id="dia-titulo">Tu objetivo de hoy</h2>${icono('llama', 'llama')}</div>
        <div class="anillo" role="progressbar" aria-label="Avance de hoy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fraccion * 100)}">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="pista" cx="60" cy="60" r="${R}"/><circle class="valor" cx="60" cy="60" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - fraccion)).toFixed(1)}"${fraccion === 0 ? ' stroke-opacity="0"' : ''}/></svg>
          <div class="anillo-centro"><span class="anillo-num">${v.minutosHechos}</span><span class="anillo-meta">/ ${meta} min</span></div>
        </div>
        <p>${frase}</p>
        <p class="ayuda">${cicloHoy ? `Hoy es ${esc(nombreDiaCiclo(cicloHoy))}. ` : ''}Tienes ${dur(v.libres)} libres; Rumbo planifica ${dur(v.capacidad)} (70%). ${boton('editar-libres', 'Cambiar', { clase: 'chico plano', etiqueta: 'Cambiar mis minutos libres' })}</p>
      </section>
    </div>
    ${bandejaHtml()}
    <div class="estadisticas">
      ${stat('reloj', `${semana7.diasConAvance} de 7`, `días con avance · ${dur(semana7.minutos)}`, 'ver-semana', `${semana7.diasConAvance} de 7 días con avance, ${dur(semana7.minutos)}. Ver mis días anteriores`)}
      ${stat('bandera', faltantes, faltantes === 1 ? 'Anotado que falta · resolver' : 'Anotados que faltan · resolver', 'ver-faltantes', `${faltantes} anotados que faltan. Ver y resolver`)}
    </div>

    ${v.items.length ? `<h2 id="plan" tabindex="-1">Mi plan de hoy</h2><ul class="lista">${v.items.map(itemHtml).join('')}</ul>` : ''}
    ${listaRecs.length ? `<h2>${principal && !pendiente ? 'Otras opciones' : v.items.length ? 'Para seguir, te recomiendo' : 'Te recomiendo'}</h2><ul class="lista">${listaRecs.map(recomendacionHtml).join('')}</ul>` : ''}
    ${v.extra ? `<h2>Si te sobra tiempo</h2><ul class="lista">${recomendacionHtml(v.extra)}</ul>` : ''}
  `;
}

// ---------- PROYECTOS ----------

/** Barras chicas de los objetivos semanales: el ritmo de esta semana, aparte del avance del proyecto. */
function ritmosHtml(r) {
  return r.ritmos
    .map(
      (x) => `<div class="ritmo"><div class="item-cabeza"><span>Ritmo semanal · ${esc(x.objetivo.nombre)}</span><span class="pct">${dur(x.minutos)} de ${dur(x.meta)}</span></div>
        ${barra(x.valor, `Ritmo semanal de ${x.objetivo.nombre}`, 'fina')}</div>`,
    )
    .join('');
}

function tarjetaProyecto(p) {
  const r = L.resumenProyecto(p, datos, hoy());
  const enRiesgo = p.estado === 'activo' ? L.objetivosVisibles(datos, p.id).filter((o) => ['en-riesgo', 'vencido'].includes(L.riesgoPlazo(o, datos, hoy())?.estado)).length : 0;
  return `<li><a class="proyecto-tarjeta${p.estado !== 'activo' ? ' apagado' : ''}" href="#/proyecto/${encodeURIComponent(p.id)}">
    <div class="item-cabeza"><h3>${esc(p.nombre)}</h3>${r.progreso === null ? '' : `<span class="pct grande">${pct(r.progreso)}</span>`}</div>
    ${r.progreso === null ? '' : barra(r.progreso, `Avance de ${p.nombre}`, 'grande')}
    ${ritmosHtml(r)}
    <p class="ayuda">${plural(r.objetivos, 'objetivo', 'objetivos')}${r.etapasLogradas ? ` · ${plural(r.etapasLogradas, 'etapa lograda', 'etapas logradas')}` : ''} · ${plural(r.tareasPendientes, 'tarea pendiente', 'tareas pendientes')} · último avance ${haceDias(r.diasSinAvance)}${p.estado !== 'activo' ? ` · ${ETIQUETA_ESTADO[p.estado].toLowerCase()}` : ''}${enRiesgo ? ` · <strong class="texto-riesgo">${plural(enRiesgo, 'objetivo en riesgo', 'objetivos en riesgo')}</strong>` : ''}</p>
  </a></li>`;
}

function vistaProyectos() {
  if (!datos.proyectos.length) return bienvenida();
  const orden = L.ordenarProyectos(datos, hoy());
  const grupo = (lista) => `<ul class="lista lista-proyectos">${lista.map(tarjetaProyecto).join('')}</ul>`;
  const principales = orden.filter((p) => p.estado === 'activo' && p.tipo === 'principal');
  const secundarios = orden.filter((p) => p.estado === 'activo' && p.tipo === 'secundario');
  const otros = orden.filter((p) => p.estado !== 'activo');
  return `
    <p class="ceja">Tu centro de proyectos</p>
    <div class="cabecera-grande"><div><h1 class="titular">Proyectos</h1><p class="bajada">Principales arriba, secundarios abajo. Cada uno con su avance.</p></div>
      <div class="fila-botones">${boton('ver-plantillas', `${icono('chispa')} Ideas de proyectos`, { clase: 'grande-boton', etiqueta: 'Ideas de proyectos' })}${boton('nuevo-proyecto', `${icono('mas')} Nuevo proyecto`, { clase: 'primario grande-boton' })}</div></div>
    <p class="ayuda">¿Dudas si algo es proyecto, objetivo o tarea? ${boton('clasificar', 'Averígualo con «¿Qué es esto?»', { clase: 'chico plano' })} · <a href="#/guia">Ver la guía</a></p>
    ${principales.length ? `<h2>Principales</h2>${grupo(principales)}` : ''}
    ${secundarios.length ? `<h2>Secundarios</h2>${grupo(secundarios)}` : ''}
    ${otros.length ? `<details class="bloque"><summary>Pausados y terminados (${otros.length})</summary>${grupo(otros)}</details>` : ''}
  `;
}

// ---------- PROYECTO ----------

function pasosHtml(t) {
  return `<ul class="pasos">${t.pasos
    .map(
      (p) => `<li><label><input type="checkbox" data-paso="${esc(t.id)}" data-paso-id="${esc(p.id)}" data-foco="paso:${esc(t.id)}:${esc(p.id)}"${p.hecho ? ' checked' : ''}> <span>${esc(p.texto)}</span></label></li>`,
    )
    .join('')}</ul>`;
}

/** Lista de notas con fecha; las "falta algo" se destacan y se pueden marcar como resueltas. */
function notasHtml(notas, { conFecha = true } = {}) {
  if (!notas.length) return '';
  return `<ul class="notas">${notas
    .map(
      (n) => `<li class="nota${n.falta ? ' falta' : ''}">
        <p>${n.falta ? '<span class="chip falta">Falta</span> ' : ''}${conFecha ? `<span class="fecha-nota">${esc(fechaCorta(n.fecha))}</span> ` : ''}<span class="texto-nota">${esc(n.texto)}</span></p>
        <span class="acciones-nota">${n.falta ? boton('nota-resuelta', 'Resuelto', { id: n.id, clase: 'chico', etiqueta: `Marcar resuelto: ${n.texto.slice(0, 40)}` }) : ''}${boton('borrar-nota', '×', { id: n.id, clase: 'chico plano', etiqueta: `Borrar nota: ${n.texto.slice(0, 40)}` })}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function tareaHtml(t) {
  const prog = L.progresoTarea(t, datos);
  // Solo cuenta una sesión pendiente: después de "Listo por hoy" puedes agregar otra si quieres seguir.
  const enPlan = L.planDeHoy(datos, hoy()).items.some((i) => i.tareaId === t.id && !i.hecho);
  const hechos = t.pasos.filter((p) => p.hecho).length;
  const notas = L.notasDeTarea(datos, t.id);
  const faltan = notas.filter((n) => n.falta).length;
  const meta = [
    chipTamano(t.tamano),
    t.pasos.length ? `<span>${hechos} de ${plural(t.pasos.length, 'paso', 'pasos')}</span>` : '',
    L.minutosTrabajados(datos, t.id) && !t.hecha ? tiempoTrabajado(t) : `<span>${dur(t.minutos)}</span>`,
    t.plazo && !t.hecha ? `<span class="${t.plazo < hoy() ? 'vencida' : ''}">${t.plazo < hoy() ? 'venció' : 'vence'} ${fechaCorta(t.plazo)}</span>` : '',
    t.hecha && t.hechaEl ? `<span>terminada el ${fechaCorta(t.hechaEl)}</span>` : '',
    faltan ? `<span class="chip falta">Falta algo</span>` : '',
    notas.length && !faltan ? `<span>${plural(notas.length, 'nota', 'notas')}</span>` : '',
    enPlan ? '<span class="chip en-plan">En tu plan de hoy</span>' : '',
  ].join('');
  const sinPasos = !t.pasos.length && t.tamano !== 'simple' && !t.hecha;
  return `<li class="tarea${t.hecha ? ' hecha' : ''}">
    <details data-tarea-id="${esc(t.id)}"${abiertas.has(t.id) ? ' open' : ''}>
      <summary>
        <span class="item-cabeza"><span class="titulo">${t.hecha ? '✓ ' : ''}${esc(t.titulo)}</span><span class="pct">${pct(prog)}</span></span>
        ${barra(prog, `Avance de ${t.titulo}`)}
        <span class="meta">${meta}</span>
      </summary>
      <div class="tarea-cuerpo">
        ${t.pasos.length ? pasosHtml(t) : ''}
        ${avisoExcedida(t)}
        ${sinPasos && !L.excedida(t, datos) ? `<div class="aviso"><p>Sin pasos, su barra avanza con el tiempo que registres (hasta 90%). Con pasos verás mejor qué te falta.</p>${boton('pasos-base', 'Usar pasos base', { id: t.id })}</div>` : ''}
        ${t.hecha ? '' : `<form class="agregar-paso" data-form="paso" data-id="${esc(t.id)}"><label class="sr" for="paso-${esc(t.id)}">Nuevo paso para ${esc(t.titulo)}</label><input id="paso-${esc(t.id)}" name="texto" maxlength="300" placeholder="Nuevo paso" autocomplete="off"><button type="submit" class="chico">Agregar paso</button></form>`}
        ${notas.length ? `<h4 class="subtitulo-chico">Notas</h4>${notasHtml(notas)}` : ''}
        <div class="fila-botones">
          ${!t.hecha && !enPlan ? boton('a-plan', 'Agregar a mi plan de hoy', { id: t.id, clase: 'chico primario' }) : ''}
          ${t.hecha ? boton('reabrir-tarea', 'Reabrir', { id: t.id }) : boton('terminar-tarea', 'Terminar tarea', { id: t.id })}
          ${boton('nota-tarea', '+ Nota', { id: t.id, etiqueta: `Agregar nota a ${t.titulo}` })}
          ${menuMas(`t:${t.id}`, `Más opciones de ${t.titulo}`, [
            boton('editar-tarea', 'Editar', { id: t.id, etiqueta: `Editar: ${t.titulo}` }),
            t.hecha ? '' : boton('tarea-subir', '↑ Antes', { id: t.id, etiqueta: `Hacer antes: ${t.titulo}` }),
            t.hecha ? '' : boton('tarea-bajar', '↓ Después', { id: t.id, etiqueta: `Hacer después: ${t.titulo}` }),
            boton('borrar-tarea', 'Borrar', { id: t.id, clase: 'chico peligro', etiqueta: `Borrar: ${t.titulo}` }),
          ])}
        </div>
      </div>
    </details>
  </li>`;
}

/** Etapas ya logradas de un objetivo: se muestran dentro de la etapa actual, con sus tareas hechas y notas. */
function etapasHtml(o) {
  const etapas = L.etapasAnteriores(datos, o);
  if (!etapas.length) return '';
  return `<details class="bloque chico etapas"><summary>Etapas anteriores logradas (${etapas.length})</summary>
    <ol class="lista-etapas">${etapas
      .map((e) => {
        const tareas = L.tareasDe(datos, e.id);
        const hechas = tareas.filter((t) => t.hecha);
        const notas = [...L.notasDeObjetivo(datos, e.id), ...tareas.flatMap((t) => L.notasDeTarea(datos, t.id))].sort((a, b) => b.fecha.localeCompare(a.fecha));
        return `<li><p><strong>Etapa ${e.etapa}: ${esc(e.nombre)}</strong> <span class="chip en-plan">Lograda</span></p>
          ${e.criterio ? `<p class="ayuda">Meta: ${esc(e.criterio)}</p>` : ''}
          ${e.tipo === 'tiempo' ? `<p class="ayuda">${dur(L.minutosRegistrados(datos, e.id, 'total', hoy()))} registrados en total.</p>` : ''}
          ${hechas.length ? `<p class="ayuda">Hiciste: ${hechas.map((t) => esc(t.titulo)).join(' · ')}</p>` : ''}
          ${notasHtml(notas)}</li>`;
      })
      .join('')}</ol></details>`;
}

function objetivoHtml(o) {
  const f = hoy();
  const prog = L.progresoObjetivo(o, datos, f);
  const notas = L.notasDeObjetivo(datos, o.id);
  let detalle;
  let cuerpo;
  let logro = '';
  if (o.tipo === 'tiempo') {
    detalle = `${dur(prog.minutos)} de ${dur(prog.meta)} ${o.periodo === 'semana' ? 'esta semana' : 'en total'}`;
    cuerpo = `<div class="fila-botones">
      ${[15, 30, 60].map((m) => boton('sumar-tiempo', `+${m} min`, { id: `${o.id}|${m}`, etiqueta: `Registrar ${m} minutos en ${o.nombre}` })).join('')}
      ${boton('otra-cantidad', 'Otra cantidad', { id: o.id })}
    </div>`;
    if (o.periodo === 'total' && prog.valor >= 1) {
      logro = `<div class="logro"><p><strong>Cumpliste la meta.</strong> ¿Quieres ir más profundo en este tema? La siguiente etapa parte desde lo que ya hiciste.</p>${boton('ampliar', 'Ampliar objetivo', { id: o.id, clase: 'chico primario', etiqueta: `Ampliar objetivo: ${o.nombre}` })}</div>`;
    }
  } else {
    const tareas = L.tareasDe(datos, o.id);
    const pendientes = tareas.filter((t) => !t.hecha);
    const hechas = tareas.filter((t) => t.hecha);
    detalle = `${prog.hechas} de ${plural(prog.total, 'tarea hecha', 'tareas hechas')}${o.logrado ? ' · marcado como logrado' : ''}`;
    if (o.logrado || (tareas.length && !pendientes.length)) {
      logro = `<div class="logro"><p><strong>${o.logrado ? '¡Objetivo logrado!' : 'Terminaste todas sus tareas.'}</strong> ¿Quieres ir más profundo en este tema? La siguiente etapa parte desde lo que ya lograste.${o.logrado ? ' Si aún falta algo, agrega una tarea y vuelve a estar en curso.' : ''}</p>
        <div class="fila-botones">${boton('ampliar', 'Ampliar objetivo', { id: o.id, clase: 'chico primario', etiqueta: `Ampliar objetivo: ${o.nombre}` })}${o.logrado ? '' : boton('logrado', 'Marcar logrado', { id: o.id })}</div></div>`;
    }
    cuerpo = `
      ${tareas.length ? '' : '<p class="ayuda">Aún no tiene tareas. Agrégalas tú o pide ideas a Claude.</p>'}
      ${pendientes.length ? `<ul class="lista tareas">${pendientes.map(tareaHtml).join('')}</ul>` : ''}
      ${hechas.length ? `<details class="bloque chico"><summary>Hechas (${hechas.length})</summary><ul class="lista tareas">${hechas.map(tareaHtml).join('')}</ul></details>` : ''}
      <div class="fila-botones">
        ${boton('nueva-tarea', '+ Tarea', { id: o.id, clase: 'chico primario', etiqueta: `Nueva tarea en ${o.nombre}` })}
        ${boton('ideas', 'Pedir ideas a Claude', { id: o.id })}
      </div>`;
  }
  return `<section class="tarjeta objetivo" aria-label="Objetivo: ${esc(o.nombre)}">
    <div class="item-cabeza"><h3 class="titulo-objetivo">${esc(o.nombre)}</h3><span class="pct grande">${pct(prog.valor)}</span></div>
    ${barra(prog.valor, `Avance del objetivo ${o.nombre}`, 'grande')}
    <p class="meta"><span class="chip">${L.esRitmoSemanal(o) ? 'Ritmo semanal' : o.tipo === 'tiempo' ? 'Tiempo' : 'Resultado'}</span>${o.etapa > 1 ? `<span class="chip etapa">Etapa ${o.etapa}</span>` : ''}<span>${detalle}</span>${o.plazo ? `<span>plazo ${fechaCorta(o.plazo)}</span>` : ''}</p>
    ${o.criterio ? `<p class="criterio"><strong>Meta:</strong> ${esc(o.criterio)}</p>` : ''}
    ${riesgoHtml(o)}
    ${logro}
    ${cuerpo}
    ${notas.length ? `<h4 class="subtitulo-chico">Notas del objetivo</h4>${notasHtml(notas)}` : ''}
    ${etapasHtml(o)}
    <div class="fila-botones acciones-objetivo">
      ${boton('nota-objetivo', '+ Nota', { id: o.id, clase: 'chico plano', etiqueta: `Agregar nota al objetivo ${o.nombre}` })}
      ${menuMas(`o:${o.id}`, `Más opciones del objetivo ${o.nombre}`, [
        boton('editar-objetivo', 'Editar objetivo', { id: o.id, clase: 'chico plano' }),
        o.tipo === 'resultado' && !logro ? boton('logrado', o.logrado ? 'Reabrir objetivo' : 'Marcar logrado', { id: o.id, clase: 'chico plano' }) : '',
        o.tipo === 'resultado' && o.logrado ? boton('logrado', 'Reabrir objetivo', { id: o.id, clase: 'chico plano' }) : '',
        !logro ? boton('ampliar', 'Siguiente etapa', { id: o.id, clase: 'chico plano', etiqueta: `Siguiente etapa de ${o.nombre}` }) : '',
        boton('borrar-objetivo', 'Borrar objetivo', { id: o.id, clase: 'chico plano peligro-texto' }),
      ])}
    </div>
  </section>`;
}

function vistaProyecto(id) {
  const p = buscar(datos.proyectos, id);
  if (!p) return `<p><a href="#/proyectos">← Proyectos</a></p><p class="vacio">Ese proyecto no existe (quizás lo borraste).</p>`;
  const r = L.resumenProyecto(p, datos, hoy());
  const objetivos = L.objetivosVisibles(datos, p.id);
  return `
    <a class="volver" href="#/proyectos">← Proyectos</a>
    <p class="ceja">Proyecto ${p.tipo}</p>
    <div class="cabecera"><div><h1 class="titular">${esc(p.nombre)}</h1>
      <p class="meta"><span class="chip">${ETIQUETA_TIPO[p.tipo]}</span>${p.estado !== 'activo' ? `<span class="chip">${ETIQUETA_ESTADO[p.estado]}</span>` : ''}<span>último avance ${haceDias(r.diasSinAvance)}</span>${r.etapasLogradas ? `<span>${plural(r.etapasLogradas, 'etapa lograda', 'etapas logradas')}</span>` : ''}</p></div>
      ${r.progreso === null ? '' : `<span class="pct enorme">${pct(r.progreso)}</span>`}</div>
    ${r.progreso === null ? '' : barra(r.progreso, `Avance de ${p.nombre}`, 'enorme')}
    ${r.ritmos.length ? `<p class="ayuda">Los objetivos semanales se muestran como ritmo: vuelven a cero cada lunes, así que no suman al avance del proyecto.</p>` : ''}
    ${p.descripcion ? `<p class="descripcion">${esc(p.descripcion)}</p>` : ''}
    <div class="fila-botones">
      ${boton('nuevo-objetivo', '+ Objetivo', { id: p.id, clase: 'primario' })}
      ${boton('ideas-objetivos', `${icono('chispa')} Ideas de objetivos`, { id: p.id, etiqueta: 'Ideas de objetivos' })}
      ${boton('editar-proyecto', 'Editar proyecto', { id: p.id, clase: '' })}
    </div>
    <h2>Objetivos</h2>
    ${objetivos.length ? objetivos.map(objetivoHtml).join('') : '<p class="vacio">Agrega el primer objetivo: qué quieres lograr, o cuánto tiempo quieres dedicarle a algo.</p>'}
    <div class="zona-peligro">${boton('borrar-proyecto', 'Borrar proyecto', { id: p.id, clase: 'chico peligro' })}</div>
  `;
}

// ---------- AJUSTES ----------

function vistaAjustes() {
  const disp = datos.disponibilidad;
  const copia = leerCopiaPrevia();
  const especiales = Object.entries(disp.excepciones).filter(([f]) => f >= hoy()).sort(([a], [b]) => a.localeCompare(b));
  return `
    <p class="ceja">Preferencias</p>
    <div class="cabecera-grande"><div><h1 class="titular">Ajustes</h1><p class="bajada">Tu tiempo, tus respaldos y cómo decide Rumbo.</p></div></div>
    <section class="tarjeta seccion">
      <h2>Mis minutos libres por día</h2>
      ${disp.ciclo ? cicloHtml(disp) : `<p class="ayuda">Tu semana normal: el tiempo que de verdad tienes para tus proyectos (fuera de turnos y obligaciones). Rumbo recomienda hasta el 70% de ese tiempo.</p>
      <form data-form="disponibilidad">
        <div class="dias">
          ${ORDEN_DIAS.map((d) => `<div class="campo"><label for="dia-${d}">${NOMBRES_DIA[d]}</label><input id="dia-${d}" name="d${d}" type="number" inputmode="numeric" min="0" max="1440" step="5" value="${disp.plantilla[d]}" required></div>`).join('')}
        </div>
        <p class="error" data-error hidden></p>
        <button class="primario" type="submit">Guardar minutos</button>
      </form>
      <h3 class="subtitulo">¿Trabajas por turnos?</h3>
      <p class="ayuda">Si tus turnos rotan (por ejemplo, 4º turno: largo, noche, saliente y libre), una semana fija no calza. Define tu ciclo una vez y Rumbo sabrá cuánto tiempo tienes cada día, sin marcar días especiales a mano.</p>
      ${boton('editar-ciclo', 'Configurar mi ciclo de turnos')}`}
      <h3 class="subtitulo">Días especiales</h3>
      ${especiales.length ? `<ul class="especiales">${especiales.map(([f, m]) => `<li><span>${esc(etiquetaDia(f))}: ${dur(m)} libres</span>${boton('quitar-excepcion', 'Quitar', { id: f, clase: 'chico plano', etiqueta: `Quitar día especial: ${etiquetaDia(f)}` })}</li>`).join('')}</ul>` : '<p class="ayuda">Ninguno. Úsalos para turnos: marca con anticipación cuánto tiempo tendrás.</p>'}
      ${boton('editar-libres', 'Marcar un día especial')}
    </section>

    <section class="tarjeta seccion">
      <h2>Respaldo</h2>
      <p>Tus datos viven solo en este navegador: sin cuentas, sin servidor, sin telemetría. Si se borran los datos del navegador, se pierden. Descarga un respaldo cada semana y guárdalo fuera (por ejemplo, en tu Drive).</p>
      <p class="ayuda">Último respaldo: ${datos.meta.ultimoRespaldo ? esc(fechaLarga(datos.meta.ultimoRespaldo)) : 'nunca'}.</p>
      <div class="fila-botones">
        ${boton('exportar', 'Descargar respaldo (.json)', { clase: 'primario' })}
        <label class="boton" for="importar">Importar respaldo…</label>
        <input id="importar" class="sr" type="file" accept="application/json,.json" data-importar>
      </div>
      ${erroresImportacion.length ? `<div class="aviso" role="alert"><p><strong>No importé el archivo:</strong></p><ul>${erroresImportacion.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${erroresImportacion.length > 8 ? `<p>…y ${erroresImportacion.length - 8} problemas más.</p>` : ''}<p>Tus datos actuales no se tocaron.</p></div>` : ''}
      ${copia ? `<p class="ayuda" style="margin-top:1rem">Hay una copia automática de antes del último reemplazo de datos (${esc(new Date(copia.cuando).toLocaleString('es-CL'))}).</p>${boton('restaurar-copia', 'Restaurar esa copia')}` : ''}
    </section>

    <section class="tarjeta seccion">
      <h2>Tu momento Rumbo</h2>
      <p class="ayuda">Rumbo no manda notificaciones: funciona si lo abres a la misma hora y en el mismo lugar.</p>
      <p>${datos.meta.momento ? `Hoy es: <strong>${esc(datos.meta.momento)}</strong>` : 'Aún no lo eliges.'}</p>
      ${boton('momento', datos.meta.momento ? 'Cambiar mi momento Rumbo' : 'Elegir mi momento Rumbo')}
    </section>

    <section class="tarjeta seccion">
      <details class="bloque"><summary>Cómo decide Rumbo</summary>
      <ul class="ayuda lista-ayuda">
        <li><strong>Orden:</strong> dentro de un objetivo, se recomiendan solo las 2 primeras tareas pendientes, en su orden (cámbialo con "Más ⋯ → ↑ Antes / ↓ Después"); en empate va primero la anterior. En objetivos de 3 o más tareas, la última (suele ser «Enviar» o «Entregar») espera a que las demás estén hechas. Una tarea posterior entra antes solo si tiene su propio plazo cercano.</li>
        <li><strong>Riesgo de plazo:</strong> en un objetivo de resultado con plazo, Rumbo compara lo que falta (en % del objetivo) con lo que avanzaste los últimos 7 días (pasos marcados, tareas terminadas y tiempo registrado) y lo que necesitas por semana para llegar. Dice «Vas en ritmo», «En riesgo» o «Plazo vencido». Un objetivo recién creado tiene unos días de margen antes de opinar. Es una estimación simple, no una predicción.</li>
        <li><strong>Objetivo logrado:</strong> al terminar su última tarea queda logrado solo (y se celebra). Si agregas o reabres una tarea, vuelve a estar en curso.</li>
        <li><strong>Motivación:</strong> al avanzar ves cuánto subió el proyecto y, al lograr un objetivo, una celebración (principio del progreso, Amabile y Kramer). Cerca de la meta (75% o más, o la última tarea), la tarea sube con "Te falta poco" (gradiente de meta, Kivetz y otros, 2006). La tarjeta verde recuerda para qué es ("Para: …"), y los lunes y el día 1 de cada mes hay mensaje de nuevo comienzo (Dai, Milkman y Riis, 2014). Sin puntos, medallas ni rachas que castiguen.</li>
        <li><strong>Foco de la semana:</strong> los objetivos que eliges en la revisión semanal suben en las recomendaciones esa semana.</li>
        <li><strong>Barra de una tarea:</strong> pasos hechos / pasos totales. Sin pasos, una tarea media o amplia avanza con el tiempo que registras, hasta 90% (el 100% llega al terminarla); una simple está en 0% o 100%.</li>
        <li><strong>Barra de un objetivo de resultado:</strong> sus tareas ponderadas por tamaño (simple 1, media 3, amplia 8), según el avance de cada una.</li>
        <li><strong>Barra de un objetivo de tiempo:</strong> minutos registrados / meta. Los semanales (lunes a domingo) se muestran como <em>ritmo semanal</em>.</li>
        <li><strong>Barra del proyecto:</strong> el promedio de sus objetivos, sin los ritmos semanales (vuelven a cero cada lunes y harían caer el proyecto).</li>
        <li><strong>Recomendaciones:</strong> suman puntos por plazo cercano o vencido, objetivos de tiempo atrasados en la semana (con más fuerza al acercarse el domingo, para que tu ritmo semanal no quede en cero), proyecto principal, días sin avanzar en el proyecto, días sin tocar la tarea (para que ninguna quede olvidada) y tareas ya empezadas. Si un objetivo no tiene tareas pendientes, te propone planificarlo. Máximo 3, hasta 2 por objetivo, que quepan en tu tiempo; aparte, un proyecto secundario con 7 días o más sin avance aparece en "Si te sobra tiempo". Son reglas prácticas, no ciencia.</li>
        <li><strong>Minutos libres:</strong> salen de tu semana fija o de tu ciclo de turnos (por ejemplo, 4º turno), y un día especial siempre manda.</li>
        <li><strong>Margen del 70%:</strong> por la <em>falacia de planificación</em> (Kahneman y Tversky, 1979; Buehler, Griffin y Ross, 1994), solemos subestimar cuánto demoramos. El sesgo tiene respaldo de investigación; el 70% es una regla práctica.</li>
        <li><strong>Etapas:</strong> cuando logras un objetivo puedes ampliarlo. La etapa lograda queda guardada dentro de la nueva, sigue contando al 100% en el avance del proyecto y Claude la recibe como contexto para proponerte algo más profundo.</li>
        <li><strong>Notas e historial:</strong> cada día guarda su plan. En "Días anteriores" ves lo que planificaste, hiciste y anotaste. Una nota marcada "falta algo" queda pendiente y sube esa tarea en las recomendaciones hasta que la marques resuelta.</li>
        <li><strong>Ideas con Claude:</strong> la app no se conecta a ninguna IA. Arma un texto que tú revisas y copias; la respuesta que pegas se valida y cada idea se acepta una por una.</li>
      </ul>
      </details>
    </section>

    <section class="tarjeta seccion">
      <h2>Apariencia</h2>
      <p class="ayuda">También puedes cambiar entre día y noche con el botón de arriba. Se recuerda en este equipo.</p>
      <fieldset class="campo"><legend class="sr">Modo de color</legend>
        ${opciones('tema-app', [['auto', 'Automático', 'Sigue al día o noche de tu teléfono o computador.'], ['claro', 'Día', 'Fondo claro.'], ['oscuro', 'Noche', 'Fondo oscuro, más descansado de noche.']], leerTema())}
      </fieldset>
    </section>

    <section class="tarjeta seccion">
      <h2>Proyecto de ejemplo</h2>
      <p class="ayuda">Agrega un proyecto de muestra para ver cómo funciona todo. Bórralo cuando quieras desde su página.</p>
      ${boton('cargar-ejemplo', 'Agregar proyecto de ejemplo')}
    </section>`;
}

// ---------- Ciclo de turnos ----------

/** Nombre de un día del ciclo: "Saliente (día 3 de 4)" o "día 3 de 4 de tu ciclo". */
const nombreDiaCiclo = (c) => (c.nombre ? `${c.nombre} (día ${c.numero} de ${c.total})` : `día ${c.numero} de ${c.total} de tu ciclo`);

/** Ajustes con ciclo activo: los próximos 7 días según el ciclo, para comprobar que calza con tus turnos. */
function cicloHtml(disp) {
  const f = hoy();
  const dias = Array.from({ length: 7 }, (_, k) => {
    const dia = L.sumarDias(f, k);
    const c = L.diaDelCiclo(disp, dia);
    const especial = disp.excepciones[dia] !== undefined;
    return `<li><span>${esc(etiquetaDia(dia))}: <strong>${esc(c.nombre || `día ${c.numero}`)}</strong></span><span>${dur(L.minutosLibres(disp, dia))}${especial ? ' · día especial' : ''}</span></li>`;
  }).join('');
  return `<p class="ayuda">Usas un <strong>ciclo de turnos de ${disp.ciclo.minutos.length} días</strong>. Rumbo recomienda hasta el 70% del tiempo libre de cada día. Tu semana fija queda guardada y vuelve si quitas el ciclo.</p>
    <ul class="especiales ciclo-proximos" aria-label="Tus próximos 7 días">${dias}</ul>
    <div class="fila-botones">${boton('editar-ciclo', 'Editar mi ciclo', { clase: 'primario' })}${boton('quitar-ciclo', 'Volver a semana fija')}</div>`;
}

function dialogoCiclo() {
  const actual = datos.disponibilidad.ciclo;
  let filas = actual
    ? actual.minutos.map((m, i) => ({ nombre: actual.nombres[i], minutos: m }))
    : L.CICLO_CUARTO_TURNO.minutos.map((m, i) => ({ nombre: L.CICLO_CUARTO_TURNO.nombres[i], minutos: m }));
  let diaHoy = actual ? L.diaDelCiclo(datos.disponibilidad, hoy()).numero : 1;
  const form = abrirDialogo(
    'Mi ciclo de turnos',
    `<p class="ayuda">Escribe los días de tu ciclo en orden y cuánto tiempo libre real te queda en cada uno (fuera del turno, traslados y descanso). Parte con el 4º turno; ajústalo a tu realidad.</p>
     <div class="campo"><label for="ciclo-largo">¿Cuántos días dura tu ciclo?</label><select id="ciclo-largo">${Array.from({ length: L.CICLO_MAX - L.CICLO_MIN + 1 }, (_, k) => k + L.CICLO_MIN).map((k) => `<option value="${k}">${k} días</option>`).join('')}</select></div>
     <div data-filas></div>
     <div class="campo"><label for="ciclo-hoy">¿Qué día de tu ciclo es hoy?</label><select id="ciclo-hoy" name="hoy"></select></div>`,
    (fd) => {
      const nombres = filas.map((_, i) => String(fd.get(`n${i}`) ?? '').trim().slice(0, 30));
      const minutos = filas.map((_, i) => Number(fd.get(`m${i}`)));
      if (!minutos.every((m) => Number.isInteger(m) && m >= 0 && m <= 1440)) return 'Cada día debe tener minutos enteros de 0 a 1440.';
      const n = Number(fd.get('hoy'));
      const ciclo = { inicio: L.sumarDias(hoy(), -(n - 1)), nombres, minutos };
      marcarLibresTutorial();
      cambiar((d) => (d.disponibilidad.ciclo = ciclo), `Ciclo guardado. Hoy es ${nombres[n - 1] || `el día ${n}`}: ${dur(minutos[n - 1])} libres.`);
    },
    'Guardar ciclo',
  );
  const $largo = form.querySelector('#ciclo-largo');
  const $hoy = form.querySelector('#ciclo-hoy');
  const pintar = () => {
    $largo.value = String(filas.length);
    form.querySelector('[data-filas]').innerHTML = filas
      .map((f, i) => `<fieldset class="fila-ciclo"><legend>Día ${i + 1}</legend>
        <div class="campo"><label for="ciclo-n${i}">Turno</label><input id="ciclo-n${i}" name="n${i}" maxlength="30" value="${esc(f.nombre)}" placeholder="Libre" aria-label="Día ${i + 1}: turno"></div>
        <div class="campo"><label for="ciclo-m${i}">Minutos libres</label><input id="ciclo-m${i}" name="m${i}" type="number" inputmode="numeric" min="0" max="1440" step="5" required value="${f.minutos}" aria-label="Día ${i + 1}: minutos libres"></div>
      </fieldset>`)
      .join('');
    diaHoy = Math.min(diaHoy, filas.length);
    $hoy.innerHTML = filas.map((f, i) => `<option value="${i + 1}"${i + 1 === diaHoy ? ' selected' : ''}>Día ${i + 1}${f.nombre ? ` · ${esc(f.nombre)}` : ''}</option>`).join('');
  };
  // Lee lo escrito antes de redibujar, para no perderlo al cambiar el largo del ciclo.
  const leer = () => {
    filas = filas.map((f, i) => ({ nombre: form.querySelector(`#ciclo-n${i}`)?.value ?? f.nombre, minutos: Number(form.querySelector(`#ciclo-m${i}`)?.value ?? f.minutos) }));
    diaHoy = Number($hoy.value) || diaHoy;
  };
  $largo.addEventListener('change', () => {
    leer();
    const k = Number($largo.value);
    filas = Array.from({ length: k }, (_, i) => filas[i] ?? { nombre: '', minutos: 120 });
    pintar();
  });
  form.addEventListener('input', (e) => {
    if (/^n\d+$/.test(e.target.name ?? '')) {
      leer();
      const i = Number(e.target.name.slice(1));
      $hoy.options[i].textContent = `Día ${i + 1}${filas[i].nombre ? ` · ${filas[i].nombre}` : ''}`;
    }
  });
  pintar();
  $largo.focus();
}

// ---------- Registrar tiempo (sin pasar por el plan) ----------

/** <select> con lo que acepta minutos: objetivos de tiempo y tareas pendientes, por proyecto activo. */
function opcionesRegistro(seleccion = '') {
  return L.ordenarProyectos(datos, hoy())
    .filter((p) => p.estado === 'activo')
    .map((p) => {
      const opciones = [];
      for (const o of L.objetivosVisibles(datos, p.id)) {
        if (o.tipo === 'tiempo') opciones.push([`o:${o.id}`, `${o.nombre} (tiempo)`]);
        else if (!o.logrado) for (const t of L.tareasDe(datos, o.id).filter((x) => !x.hecha)) opciones.push([`t:${t.id}`, t.titulo]);
      }
      return opciones.length
        ? `<optgroup label="${esc(p.nombre)}">${opciones.map(([v, n]) => `<option value="${esc(v)}"${v === seleccion ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`
        : '';
    })
    .join('');
}

/**
 * Registrar minutos de algo que hiciste fuera del plan (por ejemplo, una sesión en Lumen: solo el total).
 * Si eso mismo está pendiente en tu plan de hoy, lo marca hecho en vez de contarlo dos veces.
 */
function dialogoRegistrar() {
  let ultimo = '';
  try {
    ultimo = sessionStorage.getItem('rumbo.ultimoRegistro') ?? '';
  } catch {
    // sin almacenamiento de sesión
  }
  const opciones = opcionesRegistro(ultimo);
  if (!opciones) return avisar('Primero crea un objetivo o una tarea en tus proyectos.');
  const f = hoy();
  abrirDialogo(
    'Registrar tiempo',
    `<p class="ayuda">Para lo que hiciste sin pasar por tu plan. ¿Estudiaste en Lumen? Escribe solo el total de la sesión: el detalle queda allá.</p>
     <div class="campo"><label for="r-destino">¿En qué trabajaste?</label><select id="r-destino" name="destino" required>${opciones}</select></div>
     <div class="campos">
       <div class="campo"><label for="r-minutos">Minutos</label><input id="r-minutos" name="minutos" type="number" inputmode="numeric" min="1" max="1440" step="5" required value="30"></div>
       <div class="campo"><label for="r-fecha">Día</label><input id="r-fecha" name="fecha" type="date" max="${f}" value="${f}" required></div>
     </div>`,
    (fd) => {
      const destino = String(fd.get('destino') ?? '');
      const [tipo, id] = destino.split(':');
      const t = tipo === 't' ? buscar(datos.tareas, id) : null;
      const o = buscar(datos.objetivos, t ? t.objetivoId : id);
      if (!o) return 'Elige en qué trabajaste.';
      const m = Number(fd.get('minutos'));
      if (!Number.isInteger(m) || m < 1 || m > 1440) return 'Escribe minutos enteros, de 1 a 1440.';
      const fecha = String(fd.get('fecha') ?? '');
      if (!L.esFechaValida(fecha) || fecha > hoy()) return 'Elige hoy o un día anterior.';
      try {
        sessionStorage.setItem('rumbo.ultimoRegistro', destino);
      } catch {
        // no pasa nada si no se puede recordar
      }
      const item = fecha === hoy()
        ? L.planDeHoy(datos, fecha).items.find((i) => !i.hecho && (t ? i.tareaId === t.id : i.tipo === 'tiempo' && i.objetivoId === o.id))
        : null;
      const nombre = t ? t.titulo : o.nombre;
      cambiar((d) => {
        if (item) completarItem(d, item.id, m);
        else {
          d.registros.push({ id: crearId(), fecha, minutos: m, objetivoId: o.id, tareaId: t?.id ?? null });
          const tt = t && buscar(d.tareas, t.id);
          if (tt && (!tt.tocado || tt.tocado < fecha)) tt.tocado = fecha;
        }
      }, `Registraste ${dur(m)} en "${nombre}"${fecha !== hoy() ? ` (${fechaCorta(fecha)})` : ''}${item ? ' y quedó hecho en tu plan' : ''}.`, { celebrar: o.proyectoId });
    },
    'Registrar',
  );
}

// ---------- GUÍA ----------

/** Cómo ordenar tus cosas: las piezas, las preguntas para decidir, principal o secundario, y Rumbo con Lumen. */
function vistaGuia() {
  const pieza = (nombre, que, reconoce, ejemplo) =>
    `<li class="pieza"><h3>${nombre}</h3><p>${que}</p><p class="ayuda"><strong>Se reconoce:</strong> ${reconoce}</p><p class="ayuda"><strong>Ejemplo:</strong> ${ejemplo}</p></li>`;
  return `
    <p class="ceja">Aprende a usar Rumbo</p>
    <div class="cabecera-grande"><div><h1 class="titular">Guía</h1><p class="bajada">Cómo ordenar tus cosas sin mezclarlas.</p></div>
      <div class="fila-botones">${boton('clasificar', `${icono('chispa')} ¿Qué es esto?`, { clase: 'primario grande-boton', etiqueta: '¿Qué es esto?' })}${boton('tutorial-empezar', `${icono('play')} Hacer el tutorial`, { clase: 'grande-boton', etiqueta: 'Hacer el tutorial' })}</div></div>

    <section class="tarjeta seccion">
      <h2>Las 4 piezas, de lo grande a lo chico</h2>
      <ul class="piezas">
        ${pieza('Proyecto', 'Algo grande que te toma semanas o meses.', 'necesita varias tareas distintas y varias sesiones.', '«Postular a la UCI», «Dito Labs: primer cliente».')}
        ${pieza('Objetivo', 'Lo que quieres lograr dentro del proyecto.', 'al final puedes decir «sí, se logró». O es constancia: «3 h por semana».', '«Enviar la postulación antes del 15 de noviembre».')}
        ${pieza('Tarea', 'Una acción concreta para llegar al objetivo.', 'empieza con verbo y se hace en una o pocas sentadas.', '«Actualizar el CV», «Pedir la carta de recomendación».')}
        ${pieza('Paso', 'Las partes de una tarea mediana o grande.', 'cada uno que marcas mueve la barra de la tarea.', '«Ordenar experiencia», «Revisar ortografía».')}
      </ul>
      <p class="ayuda">Y <strong>Por ordenar</strong>: lo que se te ocurre y aún no sabes dónde va. Lo anotas con «Anotar rápido» en Mi día y lo decides después.</p>
    </section>

    <section class="tarjeta seccion">
      <h2>Las preguntas para decidir</h2>
      <p>Pasa cada cosa por estas preguntas, en orden. «¿Qué es esto?» te las hace una por una.</p>
      <ol class="lista-ayuda">
        <li><strong>¿Se hace en menos de 15 minutos?</strong> Si es parte de un proyecto, es una <em>tarea simple</em>. Si no, <em>no va en Rumbo</em>: hazla ahora o déjala en los recordatorios del teléfono.</li>
        <li><strong>¿Se hace en una o pocas sentadas?</strong> Es una <em>tarea</em> dentro de un objetivo.</li>
        <li><strong>¿Es constancia sin fin, como estudiar o entrenar?</strong> Es un <em>objetivo de tiempo</em> («Dedicarle tiempo»).</li>
        <li><strong>¿Tiene final y necesita 3 o más acciones durante semanas?</strong> Es un <em>proyecto</em>. Si tiene final pero es un solo resultado, es un <em>objetivo</em>.</li>
      </ol>
    </section>

    <section class="tarjeta seccion">
      <h2>Principal, secundario o en pausa</h2>
      <ul class="lista-ayuda">
        <li><strong>Principal:</strong> si este mes no avanza, te va a pesar. Suele tener plazo o un impacto grande. Máximo 3, mejor 2.</li>
        <li><strong>Secundario:</strong> lo quieres avanzar, pero puede esperar una semana. Rumbo te lo propone cuando te sobra tiempo.</li>
        <li><strong>En pausa:</strong> para «algún día». Créalo y pausalo: sale de tu cabeza sin pedirte tiempo.</li>
      </ul>
      <p class="ayuda">Si dudas: «Si este mes solo pudiera avanzar 2 cosas, ¿estaría esta?». Si no es un sí inmediato, es secundario.</p>
    </section>

    <section class="tarjeta seccion">
      <h2>Cómo cargarlo para no rendirte</h2>
      <ol class="lista-ayuda">
        <li><strong>Vacía la cabeza (10 min):</strong> escribe todo lo pendiente, sin ordenar. Puedes usar «Anotar rápido».</li>
        <li><strong>Clasifica</strong> cada cosa con «¿Qué es esto?».</li>
        <li><strong>Elige 2 principales</strong> y como mucho 2 secundarios. El resto, en pausa o en Por ordenar.</li>
        <li><strong>Por proyecto, 1 objetivo y 3 a 5 tareas.</strong> Cuando se acaben, Rumbo te pide planificar las siguientes.</li>
        <li><strong>La primera semana, usa solo Mi día:</strong> aceptar, hacer y marcar. Ajustas en la revisión semanal.</li>
      </ol>
      <p class="ayuda">Cargar 12 proyectos con 40 tareas el primer día es la forma más rápida de abandonar. Con poco cargado, Mi día te muestra 1 a 3 cosas, y así está pensado. <em>(Práctica común de organización.)</em></p>
    </section>

    <section class="tarjeta seccion">
      <h2>Si estudias con Lumen</h2>
      <p>Rumbo no se conecta con Lumen: no lee ni sincroniza sus datos. Tú pasas un solo dato, a mano.</p>
      <ul class="lista-ayuda">
        <li><strong>En Rumbo:</strong> el proyecto, el objetivo y la tarea de estudio («Estudiar la guía clínica»), sin pasos por capítulo.</li>
        <li><strong>En Lumen:</strong> el material, las páginas o lecciones, el temporizador, cómo te fue, las preguntas y los repasos.</li>
        <li><strong>Al terminar:</strong> en Mi día toca «Registrar tiempo» (u «Otra cantidad», si lo tenías en tu plan) y escribe solo el total de minutos de la sesión.</li>
        <li><strong>Notas en Rumbo:</strong> solo lo que cambia el plan o crea una tarea («Repasar el capítulo 4 antes del ensayo»).</li>
        <li><strong>Lo que estudias por gusto</strong> queda solo en Lumen.</li>
      </ul>
    </section>`;
}

// ---------- Tutorial (cuadro por cuadro, con seguimiento en vivo) ----------
// Los cuadros de acción se cumplen con tus datos reales: al hacerlo en la app, el tutorial avanza solo.
// Su estado es de este equipo (localStorage), como el modo día/noche.

const CLAVE_TUTORIAL = 'rumbo.tutorial';
const primerProyecto = () => (datos.proyectos[0] ? `#/proyecto/${encodeURIComponent(datos.proyectos[0].id)}` : '#/proyectos');
const CUADROS = [
  { titulo: 'Así se ordena Rumbo', texto: 'Todo se arma en 4 piezas, de lo grande a lo chico: <strong>Proyecto → Objetivo → Tarea → Paso</strong>. Cada una con su barra de avance. Te guío paso a paso, y avanzo solo cuando lo hagas en la app.' },
  { titulo: '¿Proyecto, objetivo o tarea?', texto: '<strong>Proyecto:</strong> semanas o meses, varias acciones. <strong>Objetivo:</strong> un resultado que podrás decir «logrado». <strong>Tarea:</strong> una acción con verbo, en una o pocas sentadas. Si dudas, «¿Qué es esto?» te pregunta.', extra: ['clasificar', '¿Qué es esto?'] },
  { titulo: 'Principal o secundario', texto: '<strong>Principal:</strong> si este mes no avanza, te pesa. Máximo 2 o 3. <strong>Secundario:</strong> puede esperar una semana. Lo de «algún día», en pausa.' },
  { titulo: 'Crea tu primer proyecto', texto: 'Uno solo: el más importante. Los demás los agregas después.', listo: (a) => a.proyecto, ruta: () => '#/proyectos', foco: '[data-accion="nuevo-proyecto"]' },
  { titulo: 'Ponle un objetivo concreto', texto: 'Completa «¿Cómo sabrás que lo lograste?». Si es constancia, como estudiar, elige «Dedicarle tiempo».', listo: (a) => a.objetivo, ruta: primerProyecto, foco: '[data-accion="nuevo-objetivo"]' },
  {
    titulo: 'Agrega sus primeras tareas', texto: 'De 3 a 5, cada una con verbo: «Actualizar el CV». No necesitas todo el camino hoy.',
    listo: (a) => a.tareas >= 3 || a.tiempo, basta: (a) => a.tareas >= 1, cuenta: (a) => (a.tiempo ? '' : `Llevas ${Math.min(a.tareas, 3)} de 3.`),
    ruta: primerProyecto, foco: '[data-accion="nueva-tarea"]',
  },
  { titulo: 'Dile cuánto tiempo tienes', texto: 'Tus minutos libres reales de cada día, fuera de turnos. Si tus turnos rotan, configura tu ciclo. Rumbo planifica solo el 70%, porque todo toma más de lo que creemos.', listo: (a) => a.libres, ruta: () => '#/ajustes', foco: 'form[data-form="disponibilidad"] button[type=submit]', extra: ['tutorial-libres-ok', 'Mis minutos están bien'] },
  { titulo: 'Acepta tu primera recomendación', texto: 'En Mi día, la tarjeta verde te dice qué hacer y por qué. Toca «Aceptar».', listo: (a) => a.aceptada, ruta: () => '#/hoy', foco: 'section.heroe [data-accion="aceptar"], section.heroe [data-accion="ver-igual"], section.heroe [data-accion="ir-a"]' },
  { titulo: 'Hazla y márcala', texto: 'Cuando la termines, márcala en «Mi plan de hoy». Verás cuánto subió tu proyecto. Puedes ocultar el tutorial y hacerla con calma: te espero.', listo: (a) => a.registrada, ruta: () => '#/hoy', foco: 'section.heroe [data-accion="item-hecho"], section.heroe [data-accion="terminar-tarea"], li.item [data-accion="item-hecho"], li.item [data-accion="terminar-tarea"]' },
  { titulo: 'Listo: ya sabes usar Rumbo', texto: 'Tu rutina: abre Mi día, acepta, haz y marca. El domingo, revisa tu semana. Para cargar lo demás, usa la Guía y «¿Qué es esto?».', fin: true },
];

function leerTutorial() {
  try {
    const t = JSON.parse(localStorage.getItem(CLAVE_TUTORIAL));
    if (t && Number.isInteger(t.cuadro) && ['activo', 'minimizado', 'cerrado', 'terminado'].includes(t.estado)) {
      return { ...t, cuadro: Math.min(Math.max(0, t.cuadro), CUADROS.length - 1), libres: !!t.libres };
    }
  } catch {
    // sin almacenamiento o dato dañado: se decide de nuevo
  }
  return null;
}

// Primera vez (sin proyectos): parte solo. Si ya usabas Rumbo, queda en la Guía para cuando quieras.
let tutorial = leerTutorial() ?? { estado: datos.proyectos.length ? 'cerrado' : 'activo', cuadro: 0, libres: false };
let avancePrevio = null; // para avanzar solo cuando cambian tus datos (no al volver a un cuadro ya hecho)
let cumplido = null; // título del cuadro recién cumplido, para celebrarlo en el panel
let mostrarAlPintar = false;

function guardarTutorial(cambios = {}) {
  tutorial = { ...tutorial, ...cambios };
  try {
    localStorage.setItem(CLAVE_TUTORIAL, JSON.stringify(tutorial));
  } catch {
    // sin almacenamiento: vale mientras la página esté abierta
  }
}
if (tutorial.estado === 'activo') guardarTutorial();

const avanceActual = () => L.avanceTutorial(datos, { libres: tutorial.libres });
const enCurso = () => tutorial.estado === 'activo' || tutorial.estado === 'minimizado';

function marcarLibresTutorial() {
  if (!tutorial.libres) guardarTutorial({ libres: true });
}

/** Seguimiento en vivo: si lo que pide el cuadro actual ya está hecho en tus datos, pasa al siguiente pendiente. */
function seguirTutorial() {
  if (!enCurso()) return;
  const a = avanceActual();
  const clave = JSON.stringify(a);
  if (clave === avancePrevio) return;
  avancePrevio = clave;
  // Desde el cuadro actual, el primer cuadro de acción que falta (si te adelantaste, salta hasta ahí).
  const actual = tutorial.cuadro;
  let i = CUADROS.findIndex((c, k) => k >= actual && c.listo && !c.listo(a));
  if (i === -1) i = CUADROS.length - 1;
  const hechos = CUADROS.slice(actual, i).filter((c) => c.listo?.(a));
  if (i > actual && hechos.length) {
    cumplido = hechos.at(-1).titulo;
    guardarTutorial({ cuadro: i });
  }
}

/** Ir a un cuadro; hacia adelante salta los de acción que ya hiciste. */
function irACuadro(i, { saltarHechos = false } = {}) {
  const a = avanceActual();
  let j = Math.min(Math.max(0, i), CUADROS.length - 1);
  if (saltarHechos) while (CUADROS[j]?.listo?.(a)) j++;
  cumplido = null;
  guardarTutorial({ cuadro: j, estado: 'activo' });
  pintarTutorial();
}

function pintarTutorial() {
  const $t = document.getElementById('tutorial');
  if (!$t) return;
  for (const el of document.querySelectorAll('.tutorial-foco')) el.classList.remove('tutorial-foco');
  document.body.classList.toggle('con-tutorial', tutorial.estado === 'activo');
  if (!enCurso()) {
    $t.innerHTML = '';
    return;
  }
  const i = tutorial.cuadro;
  const c = CUADROS[i];
  const a = avanceActual();
  if (tutorial.estado === 'minimizado') {
    $t.innerHTML = `<button type="button" class="tutorial-pastilla" data-accion="tutorial-abrir">${icono('chispa')} Tutorial · ${i + 1} de ${CUADROS.length}</button>`;
    return;
  }
  const hecho = c.listo?.(a);
  const accion = !!c.listo;
  let estado = '';
  if (accion) {
    estado = hecho
      ? '<p class="tutorial-estado hecho">✓ Hecho</p>'
      : `<p class="tutorial-estado"><span class="tutorial-espera" aria-hidden="true"></span> Te espero: hazlo en la app. ${c.cuenta ? esc(c.cuenta(a)) : ''}</p>`;
  }
  let siguiente;
  if (c.fin) siguiente = boton('tutorial-terminar', 'Terminar', { clase: 'chico primario' });
  else if (accion && !hecho && !c.basta?.(a)) siguiente = boton('tutorial-siguiente', 'Saltar este paso', { clase: 'chico plano' });
  else siguiente = boton('tutorial-siguiente', 'Siguiente ›', { clase: 'chico primario' });
  $t.innerHTML = `<aside class="tutorial" aria-labelledby="tutorial-titulo">
    <div class="tutorial-cabeza"><span class="tutorial-ceja">Tutorial · ${i + 1} de ${CUADROS.length}</span>
      <span>${c.fin ? '' : boton('tutorial-salir', 'Salir', { clase: 'chico plano', etiqueta: 'Salir del tutorial' })}${boton('tutorial-ocultar', 'Ocultar', { clase: 'chico plano', etiqueta: 'Ocultar el tutorial' })}</span></div>
    <ol class="tutorial-puntos" aria-hidden="true">${CUADROS.map((x, k) => `<li class="${k < i ? 'pasado' : k === i ? 'actual' : ''}"></li>`).join('')}</ol>
    <div role="status" aria-live="polite">${cumplido ? `<p class="tutorial-logro">✓ ${esc(cumplido)}: listo.</p>` : ''}</div>
    <h2 id="tutorial-titulo">${esc(c.titulo)}</h2>
    <p class="tutorial-texto">${c.texto}</p>
    ${estado}
    <div class="fila-botones">
      ${i > 0 ? boton('tutorial-anterior', '‹ Anterior', { clase: 'chico plano' }) : ''}
      ${accion && !hecho ? boton('tutorial-mostrar', 'Muéstrame dónde', { clase: 'chico' }) : ''}
      ${c.extra && !(accion && hecho) ? boton(c.extra[0], c.extra[1], { clase: 'chico' }) : ''}
      ${c.fin ? '<a class="boton chico" href="#/guia">Ver la guía</a>' : ''}
      ${siguiente}
    </div>
  </aside>`;
  if (accion && !hecho) {
    const objetivo = document.querySelector(c.foco);
    objetivo?.classList.add('tutorial-foco');
    if (mostrarAlPintar && objetivo) {
      // Arriba de la pantalla, para que el panel (abajo en el teléfono) no lo tape.
      window.scrollBy({ top: objetivo.getBoundingClientRect().top - 110, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      objetivo.focus({ preventScroll: true });
    }
  }
  mostrarAlPintar = false;
}

/** Lleva a la pantalla del cuadro y resalta dónde tocar. */
function mostrarDondeTutorial() {
  const c = CUADROS[tutorial.cuadro];
  const ruta = c.ruta?.();
  mostrarAlPintar = true;
  if (ruta && location.hash !== ruta) location.hash = ruta; // al redibujar, pintarTutorial lo muestra
  else pintarTutorial();
}

// ---------- ¿Qué es esto? (clasificar algo, pregunta por pregunta) ----------

let clasif = null; // { texto, respuestas: [], bandejaId }

function dialogoClasificar(texto = '', bandejaId = null) {
  clasif = { texto, respuestas: [], bandejaId };
  if (texto) return pintarClasificar();
  abrirDialogo(
    '¿Qué es esto?',
    `<p class="ayuda">Te hago unas preguntas de sí o no y te digo si es proyecto, objetivo, tarea o algo que no va en Rumbo.</p>
     <div class="campo"><label for="c-texto">¿Qué quieres ordenar?</label><input id="c-texto" name="texto" maxlength="300" required autocomplete="off" placeholder="Postular a la UCI"></div>`,
    (fd) => {
      const t = String(fd.get('texto') ?? '').trim();
      if (!t) return 'Escribe qué quieres ordenar.';
      clasif.texto = t.slice(0, 300);
      pintarClasificar();
      return false;
    },
    'Empezar',
  );
}

function pintarClasificar() {
  const paso = L.pasoClasificar(clasif.respuestas);
  const cosa = `<p class="clasif-cosa">«${esc(clasif.texto)}»</p>`;
  let cuerpo;
  if (paso.tipo === 'pregunta') {
    cuerpo = `<p class="ceja">Pregunta ${paso.numero}</p>${cosa}
      <h3 class="clasif-pregunta">${esc(paso.texto)}</h3>
      <p class="ayuda">${esc(paso.ayuda)}</p>
      <div class="fila-botones clasif-respuestas">${boton('clasif-responder', 'Sí', { id: 'si', clase: 'primario' })}${boton('clasif-responder', 'No', { id: 'no' })}</div>
      <div class="fila-botones">${clasif.respuestas.length ? boton('clasif-atras', '‹ Atrás', { clase: 'chico plano' }) : ''}${boton('cerrar-dialogo', 'Cerrar', { clase: 'chico plano' })}</div>`;
  } else {
    cuerpo = `<p class="ceja">Resultado</p>${cosa}
      <p class="clasif-resultado">Es: <strong>${esc(paso.nombre)}</strong></p>
      <p>${esc(paso.texto)}</p>
      ${resultadoClasificarHtml(paso)}
      <details class="consejos"><summary>Por qué</summary><ul>${clasif.respuestas
        .map((r, k) => `<li>${esc(L.pasoClasificar(clasif.respuestas.slice(0, k)).texto)} <strong>${r ? 'Sí' : 'No'}</strong></li>`)
        .join('')}</ul></details>
      <div class="fila-botones">${boton('clasif-atras', '‹ Cambiar una respuesta', { clase: 'chico plano' })}${boton('clasif-otra', 'Clasificar otra cosa', { clase: 'chico plano' })}${boton('cerrar-dialogo', 'Cerrar', { clase: 'chico plano' })}</div>`;
  }
  $dialogo.innerHTML = `<form novalidate data-clasificar><h2 id="dialogo-titulo">¿Qué es esto?</h2>${cuerpo}<p class="error" data-error hidden></p></form>`;
  $dialogo.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
  if (!$dialogo.open) $dialogo.showModal();
  $dialogo.querySelector('.clasif-respuestas button, select, .clasif-accion')?.focus();
}

/** Qué hacer con el resultado: crearlo donde corresponde o dejarlo en «Por ordenar». */
function resultadoClasificarHtml(paso) {
  const desdeBandeja = !!clasif.bandejaId;
  const porOrdenar = desdeBandeja ? '' : boton('clasif-por-ordenar', 'Dejar en «Por ordenar»', { clase: 'chico' });
  if (paso.pieza === 'tarea') {
    const opciones = opcionesObjetivos();
    if (!opciones) return `<p class="ayuda">Aún no tienes objetivos donde ponerla. Crea primero su proyecto, o déjala en «Por ordenar» por ahora.</p><div class="fila-botones">${porOrdenar}</div>`;
    return `<div class="campo"><label for="c-objetivo">¿En qué objetivo va?</label><select id="c-objetivo">${opciones}</select></div>
      <div class="fila-botones">${boton('clasif-crear', 'Crear la tarea', { clase: 'chico primario clasif-accion' })}${porOrdenar}</div>`;
  }
  if (paso.pieza === 'objetivo') {
    const activos = L.ordenarProyectos(datos, hoy()).filter((p) => p.estado === 'activo');
    const nuevo = boton('clasif-crear-proyecto-para', 'Crear un proyecto para este objetivo', { clase: `chico${activos.length ? '' : ' primario clasif-accion'}` });
    if (!activos.length) return `<p class="ayuda">Un objetivo va dentro de un proyecto, y aún no tienes ninguno activo.</p><div class="fila-botones">${nuevo}${porOrdenar}</div>`;
    return `<div class="campo"><label for="c-proyecto">¿De qué proyecto es parte?</label><select id="c-proyecto">${activos.map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="fila-botones">${boton('clasif-crear', 'Crear el objetivo', { clase: 'chico primario clasif-accion' })}${nuevo}</div>`;
  }
  if (paso.pieza === 'proyecto') {
    const n = L.principalesActivos(datos);
    const aviso = paso.tipoProyecto === 'principal' && n >= 3
      ? `<p class="aviso">Ya tienes ${n} proyectos principales. Antes de sumar otro, considera pasar uno a secundario: con muchos, todo avanza lento.</p>` : '';
    return `${aviso}<div class="fila-botones">${boton('clasif-crear', paso.estado === 'pausado' ? 'Crear en pausa' : 'Crear el proyecto', { clase: 'chico primario clasif-accion' })}</div>`;
  }
  if (paso.pieza === 'fuera' && desdeBandeja) return `<div class="fila-botones">${boton('clasif-quitar', 'Sacar de «Por ordenar»', { clase: 'chico primario clasif-accion' })}</div>`;
  if (paso.pieza === 'idea' && desdeBandeja) return '<p class="ayuda">Ya está en «Por ordenar». Decide en tu revisión semanal.</p>';
  return `<div class="fila-botones">${porOrdenar}</div>`;
}

/** Saca de «Por ordenar» lo que acabas de clasificar, dentro del mismo cambio (un solo Deshacer). */
const sacarDeBandeja = (bandejaId) => (d) => {
  if (bandejaId) d.bandeja = d.bandeja.filter((b) => b.id !== bandejaId);
};

function crearDesdeClasificar() {
  const paso = L.pasoClasificar(clasif.respuestas);
  const { texto, bandejaId } = clasif;
  const quitar = sacarDeBandeja(bandejaId);
  if (paso.pieza === 'tarea') {
    const objetivoId = $dialogo.querySelector('#c-objetivo')?.value;
    if (!objetivoId) return;
    const tamano = paso.id === 'tarea-simple' ? { tamano: 'simple', minutos: L.TAMANOS.simple.minutos } : L.TAREA_RAPIDA;
    const tarea = L.nuevaTarea({ id: crearId(), objetivoId, titulo: texto, ...tamano, creado: hoy() });
    $dialogo.close();
    cambiar((d) => {
      d.tareas.push(tarea);
      quitar(d);
    }, `Tarea creada en "${buscar(datos.objetivos, objetivoId).nombre}".`);
    return;
  }
  if (paso.pieza === 'objetivo') {
    const proyectoId = $dialogo.querySelector('#c-proyecto')?.value;
    if (!proyectoId) return;
    location.hash = `#/proyecto/${encodeURIComponent(proyectoId)}`;
    dialogoObjetivo(proyectoId, null, false, null, { nombre: texto, tipo: paso.id === 'objetivo-tiempo' ? 'tiempo' : 'resultado', alCrear: quitar });
    return;
  }
  if (paso.estado === 'pausado') {
    const proyecto = { id: crearId(), nombre: texto, tipo: 'secundario', estado: 'pausado', descripcion: '', creado: hoy() };
    $dialogo.close();
    cambiar((d) => {
      d.proyectos.push(proyecto);
      quitar(d);
    }, `"${texto}" quedó en pausa. Actívalo cuando sea su momento (en Editar proyecto).`);
    return;
  }
  dialogoProyecto(null, null, { nombre: texto, tipo: paso.tipoProyecto, alCrear: quitar });
}

// ---------- Diálogos ----------

/**
 * Abre un diálogo con formulario. `alEnviar(fd, form)` devuelve un texto de error (se muestra),
 * `false` (queda abierto sin error) o nada (se cierra).
 */
function abrirDialogo(titulo, cuerpo, alEnviar, textoEnviar = 'Guardar', extraBotones = '') {
  $dialogo.innerHTML = `<form novalidate>
    <h2 id="dialogo-titulo">${esc(titulo)}</h2>${cuerpo}
    <p class="error" data-error hidden></p>
    <div class="fila-botones"><button class="primario" type="submit">${esc(textoEnviar)}</button>${extraBotones}<button type="button" data-accion="cerrar-dialogo">Cerrar</button></div>
    <div data-extra></div>
  </form>`;
  const form = $dialogo.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = alEnviar(new FormData(form), form);
    const $e = form.querySelector('[data-error]');
    if (typeof r === 'string') {
      $e.textContent = r;
      $e.hidden = false;
    } else {
      $e.hidden = true;
      if (r === false) return;
      // Si se abrió desde la revisión semanal (p. ej. mover un plazo), se vuelve a ella en vez de cerrar.
      if (form.dataset.volverRevision) dialogoRevision();
      else if ($dialogo.querySelector('form') === form) $dialogo.close();
    }
  });
  form.addEventListener('input', () => (form.querySelector('[data-error]').hidden = true));
  if (!$dialogo.open) $dialogo.showModal(); // al pasar de un diálogo a otro, se reutiliza el mismo
  form.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea')?.focus();
  return form;
}

const textoErrores = (errores) => `Revisa: ${errores.join(', ')}.`;

function opciones(nombre, lista, actual) {
  return `<div class="opciones" role="radiogroup">${lista
    .map(
      ([valor, titulo, detalle]) => `<label class="opcion"><input type="radio" name="${nombre}" value="${valor}"${valor === actual ? ' checked' : ''}><span><strong>${titulo}</strong>${detalle ? `<small>${detalle}</small>` : ''}</span></label>`,
    )
    .join('')}</div>`;
}

/** Consejos breves para escribir bien un proyecto, objetivo o tarea (plegados para no estorbar). */
const CONSEJOS = {
  proyecto: `<ul>
      <li>Un proyecto es algo que quieres sacar adelante en semanas o meses, no una tarea suelta.</li>
      <li><strong>Principal</strong> es donde está tu foco. Mejor pocos a la vez (1 a 3): con muchos, todo avanza lento. <em>(Práctica común.)</em></li>
      <li>Mejor evitar: «Cosas de la app». Mejor así: «FarmaCheck: beta privada».</li>
    </ul>`,
  objetivo: `<ul>
      <li>Concreto y verificable: completa «Sabré que lo logré cuando…». Las metas específicas y desafiantes suelen rendir más que «hacer lo mejor posible» <em>(Locke y Latham, teoría de fijación de metas; investigación sólida).</em></li>
      <li>Ponle plazo si lo tiene: Rumbo lo usa para priorizar.</li>
      <li>Si es algo de constancia (estudiar, practicar), elige «Dedicarle tiempo».</li>
      <li>Mejor evitar: «Mejorar FarmaCheck». Mejor así: «Beta con 10 enfermeras usándola antes del 30 de octubre».</li>
    </ul>`,
  tarea: `<ul>
      <li>Empieza con un verbo y que el primer paso sea obvio: «Escribir…», «Llamar a…», «Enviar…».</li>
      <li>Si dura más de 2 horas, es amplia: pártela en pasos que quepan en una sesión.</li>
      <li>Los pasos mueven la barra: mejor 3 a 5 pasos claros que uno enorme.</li>
      <li>Mejor evitar: «Landing». Mejor así: «Escribir los textos de la landing».</li>
    </ul>`,
};
const consejosHtml = (tipo) => `<details class="consejos"><summary>Ideas para escribirlo bien</summary>${CONSEJOS[tipo]}</details>`;

/** Galería de ideas de proyectos: cada una trae objetivos concretos con tareas y pasos. */
function dialogoPlantillas() {
  abrirDialogo(
    'Ideas de proyectos',
    `<p class="ayuda">Elige una idea y Rumbo crea el proyecto con objetivos concretos, tareas y pasos. Después lo ajustas a tu medida.</p>
     <ul class="lista plantillas">${PLANTILLAS.map((pl) => {
       const tareas = pl.objetivos.reduce((s, o) => s + (o.tareas?.length ?? 0), 0);
       return `<li class="plantilla">
         <h3>${esc(pl.nombre)}</h3>
         <p class="ayuda">${esc(pl.descripcion)}</p>
         <ul class="plantilla-objetivos">${pl.objetivos.map((o) => `<li>${o.tipo === 'tiempo' ? `Dedicarle ${o.horas} h por semana: ${esc(o.nombre.toLowerCase())}` : `${esc(o.nombre)}${o.criterio ? ` <span class="ayuda">· meta: ${esc(o.criterio)}</span>` : ''}`}</li>`).join('')}</ul>
         <div class="fila-botones">${boton('usar-plantilla', 'Usar esta idea', { id: pl.id, clase: 'chico primario', etiqueta: `Usar la idea: ${pl.nombre}` })}<span class="ayuda">${plural(pl.objetivos.length, 'objetivo', 'objetivos')} · ${plural(tareas, 'tarea', 'tareas')}</span></div>
       </li>`;
     }).join('')}</ul>`,
    () => {},
    'Cerrar',
  );
  $dialogo.querySelector('button[type=submit]').remove(); // aquí solo se elige una idea
}

/** `inicial` (desde «¿Qué es esto?»): nombre y tipo sugeridos, el objetivo que sigue y `alCrear(d)` para sacarlo de «Por ordenar». */
function dialogoProyecto(p = null, plantilla = null, inicial = {}) {
  const nuevo = !p;
  const base = p ?? { id: crearId(), nombre: inicial.nombre ?? '', tipo: inicial.tipo ?? 'principal', estado: 'activo', descripcion: plantilla?.descripcion ?? '', creado: hoy() };
  abrirDialogo(
    nuevo ? (plantilla ? `Nuevo proyecto: ${plantilla.nombre.toLowerCase()}` : 'Nuevo proyecto') : 'Editar proyecto',
    `${plantilla ? `<p class="ayuda">Se crea con ${plural(plantilla.objetivos.length, 'objetivo', 'objetivos')} y sus tareas. Solo ponle nombre.</p>` : ''}
     ${nuevo && !plantilla ? `<p class="ayuda">¿Sin ideas? ${boton('ver-plantillas', 'Ver ideas de proyectos', { clase: 'chico plano' })}</p>` : ''}
     ${consejosHtml('proyecto')}
     ${nuevo && !plantilla ? `<p class="ayuda">¿No sabes si es proyecto? ${boton('clasificar', '¿Qué es esto?', { clase: 'chico plano' })}</p>` : ''}
     <div class="campo"><label for="p-nombre">Nombre</label><input id="p-nombre" name="nombre" maxlength="300" required value="${esc(base.nombre)}" placeholder="${esc(plantilla?.ejemplo ?? 'FarmaCheck')}"></div>
     <fieldset class="campo"><legend>¿Qué tan importante es?</legend>
       ${opciones('tipo', [['principal', 'Principal', 'Donde está tu foco. Se recomienda primero.'], ['secundario', 'Secundario', 'Avanza cuando hay tiempo.']], base.tipo)}
     </fieldset>
     <div class="campo"><label for="p-desc">De qué se trata (opcional)</label><textarea id="p-desc" name="descripcion" maxlength="5000" placeholder="Una o dos líneas. Ayuda a Claude a darte mejores ideas.">${esc(base.descripcion)}</textarea></div>
     ${nuevo ? '' : `<div class="campo"><label for="p-estado">Estado</label><select id="p-estado" name="estado">${L.ESTADOS_PROYECTO.map((e) => `<option value="${e}"${e === base.estado ? ' selected' : ''}>${ETIQUETA_ESTADO[e]}</option>`).join('')}</select><p class="ayuda">Los pausados y terminados no reciben recomendaciones.</p></div>`}`,
    (fd) => {
      const proyecto = {
        ...base,
        nombre: String(fd.get('nombre') ?? '').trim(),
        tipo: fd.get('tipo'),
        descripcion: String(fd.get('descripcion') ?? ''),
        estado: nuevo ? 'activo' : fd.get('estado'),
      };
      const errores = L.erroresProyecto(proyecto);
      if (errores.length) return textoErrores(errores);
      if (nuevo && plantilla) {
        const { objetivos, tareas } = aplicarPlantilla(plantilla, proyecto.id, hoy(), crearId);
        cambiar((d) => {
          d.proyectos.push(proyecto);
          d.objetivos.push(...objetivos);
          d.tareas.push(...tareas);
        }, `Proyecto creado con ${plural(objetivos.length, 'objetivo', 'objetivos')} y ${plural(tareas.length, 'tarea', 'tareas')}. Ajústalos a tu medida.`);
        location.hash = `#/proyecto/${encodeURIComponent(proyecto.id)}`;
      } else if (nuevo) {
        cambiar((d) => {
          d.proyectos.push(proyecto);
          inicial.alCrear?.(d);
        }, 'Proyecto creado.');
        location.hash = `#/proyecto/${encodeURIComponent(proyecto.id)}`;
        // Flujo natural: un proyecto nuevo pide su primer objetivo.
        setTimeout(() => dialogoObjetivo(proyecto.id, null, true, null, inicial.objetivo ?? {}), 0);
      } else {
        cambiar((d) => (d.proyectos[d.proyectos.findIndex((x) => x.id === proyecto.id)] = proyecto), 'Proyecto guardado.');
      }
    },
    nuevo ? 'Crear proyecto' : 'Guardar',
  );
}

/**
 * Crear, editar o ampliar un objetivo.
 * - Nuevo: meta concreta ("¿cómo sabrás que lo lograste?") y, si es de resultado, las tareas para llegar (una por línea).
 * - Ampliar (`ampliarDe`): crea la siguiente etapa; la anterior queda lograda y guardada dentro de la nueva.
 */
function dialogoObjetivo(proyectoId, o = null, primero = false, ampliarDe = null, inicial = {}) {
  const nuevo = !o;
  const base =
    o ??
    L.nuevoObjetivo({
      id: crearId(),
      proyectoId: ampliarDe?.proyectoId ?? proyectoId,
      nombre: inicial.nombre ?? '',
      tipo: ampliarDe?.tipo ?? inicial.tipo ?? 'resultado',
      minutosMeta: ampliarDe?.minutosMeta ?? null,
      periodo: ampliarDe?.periodo ?? null,
      creado: hoy(),
    });
  const horas = base.minutosMeta ? base.minutosMeta / 60 : 3;
  const pendientes = ampliarDe ? L.tareasDe(datos, ampliarDe.id).filter((t) => !t.hecha).length : 0;
  const faltantes = ampliarDe ? L.faltantesSueltos(datos, ampliarDe.id, { llevarPendientes: true }) : [];
  let titulo = nuevo ? 'Nuevo objetivo' : 'Editar objetivo';
  let intro = '';
  if (primero) {
    titulo = 'Primer objetivo del proyecto';
    intro = '<p class="ayuda">¿Qué quieres lograr? Mientras más concreto, mejor: podrás ampliarlo cuando lo logres.</p>';
  } else if (ampliarDe) {
    titulo = `Siguiente etapa de "${ampliarDe.nombre}"`;
    intro = `<p class="ayuda">No partes de cero: "${esc(ampliarDe.nombre)}" queda como etapa ${ampliarDe.etapa} lograda, guardada con sus tareas y notas, y sigue contando en el avance del proyecto. Claude recibe todo eso como contexto para proponerte algo más profundo.</p>`;
  }
  const form = abrirDialogo(
    titulo,
    `${intro}
     ${consejosHtml('objetivo')}
     <fieldset class="campo"><legend>Tipo de objetivo</legend>
       ${opciones('tipo', [['resultado', 'Lograr algo', 'Se completa con tareas. Ej.: lanzar la beta.'], ['tiempo', 'Dedicarle tiempo', 'Se completa registrando minutos. Ej.: estudiar 3 h por semana.']], base.tipo)}
     </fieldset>
     <div class="campo"><label for="o-nombre">Nombre del objetivo</label><input id="o-nombre" name="nombre" maxlength="300" required value="${esc(base.nombre)}" placeholder="${ampliarDe ? 'Beta pública' : 'Lanzar la beta'}"></div>
     <div class="campo"><label for="o-criterio">¿Cómo sabrás que lo lograste? (opcional)</label><input id="o-criterio" name="criterio" maxlength="500" value="${esc(base.criterio)}" placeholder="20 enfermeras usándola cada semana"></div>
     <div class="campos solo-tiempo">
       <div class="campo"><label for="o-horas">Meta en horas</label><input id="o-horas" name="horas" type="number" inputmode="decimal" min="0.25" max="1600" step="0.25" value="${horas}"></div>
       <div class="campo"><label for="o-periodo">Cada cuánto</label><select id="o-periodo" name="periodo"><option value="semana"${base.periodo !== 'total' ? ' selected' : ''}>Por semana</option><option value="total"${base.periodo === 'total' ? ' selected' : ''}>En total</option></select></div>
     </div>
     <div class="campo"><label for="o-plazo">Plazo (opcional)</label><input id="o-plazo" name="plazo" type="date" value="${esc(base.plazo ?? '')}"></div>
     ${nuevo ? `<div class="solo-resultado">
       <div class="campo"><label for="o-tareas">Tareas para llegar (una por línea, opcional)</label>
         <textarea id="o-tareas" name="tareas" rows="4" placeholder="Definir lista de medicamentos&#10;Diseñar pantalla de búsqueda&#10;Probar con 3 colegas"></textarea>
         <p class="ayuda">Se crean como tareas medias de 1 h. Después les ajustas el tamaño y les agregas pasos.</p></div>
       ${pendientes ? `<div class="checks"><label><input type="checkbox" name="llevar" value="1" checked> Llevar ${plural(pendientes, 'la tarea pendiente', `las ${pendientes} tareas pendientes`)} a esta etapa</label></div>` : ''}
       ${faltantes.length ? `<div class="checks columna"><label><input type="checkbox" name="faltantes" value="1" checked> Convertir en tareas lo que anotaste que faltaba (${faltantes.length})</label>
         <ul class="ayuda lista-faltantes">${faltantes.map((n) => `<li>${esc(n.texto.length > 90 ? `${n.texto.slice(0, 90)}…` : n.texto)}</li>`).join('')}</ul></div>` : ''}
       <div class="checks"><label><input type="checkbox" name="ideas" value="1"> Al terminar, pedir ideas de tareas a Claude</label></div>
     </div>` : ''}`,
    (fd) => {
      const tipo = fd.get('tipo');
      const objetivo = {
        ...base,
        tipo,
        nombre: String(fd.get('nombre') ?? '').trim(),
        criterio: String(fd.get('criterio') ?? '').trim(),
        plazo: fd.get('plazo') || null,
        minutosMeta: tipo === 'tiempo' ? Math.round(Number(fd.get('horas')) * 60) : null,
        periodo: tipo === 'tiempo' ? fd.get('periodo') : null,
        logrado: tipo === 'tiempo' ? false : base.logrado,
      };
      if (!nuevo && o.tipo !== tipo && L.tareasDe(datos, o.id).length) return 'Este objetivo tiene tareas: no puede pasar a ser de tiempo.';
      const errores = L.erroresObjetivo(objetivo, new Set(datos.proyectos.map((p) => p.id)));
      if (errores.length) return textoErrores(errores);
      const tareas = nuevo && tipo === 'resultado' ? L.tareasDesdeLineas(fd.get('tareas'), objetivo.id, hoy(), crearId) : [];
      const mensaje = ampliarDe ? `Etapa ${ampliarDe.etapa + 1} creada.` : nuevo ? 'Objetivo creado.' : 'Objetivo guardado.';
      cambiar((d) => {
        if (ampliarDe) {
          L.ampliarObjetivo(d, ampliarDe.id, objetivo, { llevarPendientes: !!fd.get('llevar'), faltantesComoTareas: !!fd.get('faltantes'), crearId, fecha: hoy() });
        }
        else if (nuevo) {
          d.objetivos.push(objetivo);
          inicial.alCrear?.(d);
        }
        else d.objetivos[d.objetivos.findIndex((x) => x.id === objetivo.id)] = objetivo;
        d.tareas.push(...tareas);
      }, tareas.length ? `${mensaje} Con ${plural(tareas.length, 'tarea', 'tareas')}.` : mensaje);
      if (fd.get('ideas') && tipo === 'resultado') setTimeout(() => dialogoIdeas(objetivo.id), 0);
    },
    ampliarDe ? 'Crear siguiente etapa' : nuevo ? 'Crear objetivo' : 'Guardar',
  );
  const actualizar = () => form.classList.toggle('es-tiempo', form.querySelector('input[name=tipo]:checked')?.value === 'tiempo');
  form.addEventListener('change', actualizar);
  actualizar();
  form.querySelector('#o-nombre').focus();
}

/** Nota con fecha, ligada a un objetivo o a una tarea. "Falta algo" la deja pendiente hasta resolverla. */
function dialogoNota({ objetivoId, tareaId, fecha, titulo }) {
  abrirDialogo(
    titulo,
    `<div class="campo"><label for="n-texto">Nota</label><textarea id="n-texto" name="texto" rows="4" maxlength="2000" required placeholder="Cómo lo hice, qué aprendí o qué me falta"></textarea></div>
     <div class="checks"><label><input type="checkbox" name="falta" value="1"> Falta algo: dejarla pendiente hasta resolverla</label></div>
     ${fecha !== hoy() ? `<p class="ayuda">Queda guardada en el ${esc(fechaLarga(fecha))}.</p>` : ''}`,
    (fd) => {
      const nota = { id: crearId(), fecha, texto: String(fd.get('texto') ?? '').trim(), objetivoId, tareaId, falta: !!fd.get('falta') };
      const errores = L.erroresNota(nota, new Map(datos.objetivos.map((x) => [x.id, x])), new Set(datos.tareas.map((t) => t.id)));
      if (errores.length) return textoErrores(errores);
      if (tareaId) abiertas.add(tareaId);
      cambiar((d) => d.notas.push(nota), nota.falta ? 'Nota guardada como pendiente.' : 'Nota guardada.');
    },
    'Guardar nota',
  );
}

function leerPasos(texto, anteriores = []) {
  const libres = [...anteriores];
  return String(texto ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((textoPaso) => {
      const i = libres.findIndex((p) => p.texto === textoPaso);
      if (i >= 0) return libres.splice(i, 1)[0]; // conserva si ya estaba hecho
      return { id: crearId(), texto: textoPaso, hecho: false };
    });
}

function dialogoTarea(objetivoId, t = null) {
  const nueva = !t;
  const o = buscar(datos.objetivos, t?.objetivoId ?? objetivoId);
  const base = t ?? L.nuevaTarea({ id: crearId(), objetivoId: o.id, titulo: '', creado: hoy() });
  const hermanos = datos.objetivos.filter((x) => x.proyectoId === o.proyectoId && x.tipo === 'resultado');
  const form = abrirDialogo(
    nueva ? `Nueva tarea · ${o.nombre}` : 'Editar tarea',
    `${consejosHtml('tarea')}
     <div class="campo"><label for="t-titulo">Qué hay que hacer</label><input id="t-titulo" name="titulo" maxlength="300" required value="${esc(base.titulo)}" placeholder="Escribir los textos de la landing"></div>
     <fieldset class="campo"><legend>Tamaño</legend>
       ${opciones('tamano', Object.entries(L.TAMANOS).map(([k, v]) => [k, v.nombre, v.detalle]), base.tamano)}
     </fieldset>
     <div class="campos">
       <div class="campo"><label for="t-minutos">Minutos estimados (total)</label><input id="t-minutos" name="minutos" type="number" inputmode="numeric" min="1" max="1440" step="5" required value="${base.minutos}"></div>
       <div class="campo"><label for="t-plazo">Plazo (opcional)</label><input id="t-plazo" name="plazo" type="date" value="${esc(base.plazo ?? '')}"></div>
     </div>
     ${!nueva && hermanos.length > 1 ? `<div class="campo"><label for="t-objetivo">Objetivo</label><select id="t-objetivo" name="objetivoId">${hermanos.map((x) => `<option value="${esc(x.id)}"${x.id === base.objetivoId ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>` : ''}
     <div class="campo"><label for="t-pasos">Pasos (uno por línea)</label>
       <textarea id="t-pasos" name="pasos" rows="5" placeholder="Primer paso&#10;Segundo paso">${esc(base.pasos.map((p) => p.texto).join('\n'))}</textarea>
       <p class="ayuda">Los pasos son los objetivos de la tarea: cada uno que marques mueve su barra. ${boton('rellenar-pasos-base', 'Usar pasos base', { clase: 'chico plano' })}</p>
     </div>`,
    (fd) => {
      const tarea = {
        ...base,
        titulo: String(fd.get('titulo') ?? '').trim(),
        tamano: fd.get('tamano'),
        minutos: Number(fd.get('minutos')),
        plazo: fd.get('plazo') || null,
        objetivoId: fd.get('objetivoId') || base.objetivoId,
        pasos: leerPasos(fd.get('pasos'), base.pasos),
      };
      const errores = L.erroresTarea(tarea, new Map(datos.objetivos.map((x) => [x.id, x])));
      if (errores.length) return textoErrores(errores);
      const reabre = o.logrado && nueva;
      cambiar((d) => {
        if (nueva) d.tareas.push(tarea);
        else {
          d.tareas[d.tareas.findIndex((x) => x.id === tarea.id)] = tarea;
          if (tarea.objetivoId !== t.objetivoId) L.moverTarea(d, tarea.id, tarea.objetivoId); // sus notas se van con ella
        }
        // Una tarea pendiente en un objetivo logrado lo vuelve a poner en curso (si no, nunca se recomendaría).
        L.reabrirSiPendiente(d, tarea.objetivoId);
      }, nueva ? (reabre ? `Tarea creada. "${o.nombre}" vuelve a estar en curso.` : 'Tarea creada.') : 'Tarea guardada.');
    },
    nueva ? 'Crear tarea' : 'Guardar',
  );
  // Si no tocaste los minutos, siguen el tamaño elegido.
  const $min = form.querySelector('#t-minutos');
  let minutosTocados = !nueva;
  $min.addEventListener('input', () => (minutosTocados = true));
  form.addEventListener('change', (e) => {
    if (e.target.name === 'tamano' && !minutosTocados) $min.value = L.TAMANOS[e.target.value].minutos;
  });
}

function dialogoMinutos(titulo, defecto, alGuardar) {
  abrirDialogo(
    titulo,
    `<div class="campo"><label for="m-minutos">Minutos</label><input id="m-minutos" name="minutos" type="number" inputmode="numeric" min="1" max="1440" step="5" required value="${defecto}"></div>`,
    (fd) => {
      const m = Number(fd.get('minutos'));
      if (!Number.isInteger(m) || m < 1 || m > 1440) return 'Escribe minutos enteros, de 1 a 1440.';
      alGuardar(m);
    },
    'Registrar',
  );
}

/** "Hoy", "Mañana" o la fecha larga: para nombrar días especiales. */
function etiquetaDia(f) {
  if (f === hoy()) return 'Hoy';
  if (f === L.sumarDias(hoy(), 1)) return 'Mañana';
  const larga = fechaLarga(f);
  return larga[0].toUpperCase() + larga.slice(1);
}

/** Minutos libres de un día puntual (hoy, mañana o cualquier día futuro): para turnos y días especiales. */
function dialogoLibres() {
  const f = hoy();
  const form = abrirDialogo(
    'Minutos libres de un día',
    `<p class="ayuda">Para turnos y días especiales. Tu semana normal se cambia en Ajustes.</p>
     <div class="campos">
       <div class="campo"><label for="libres-dia">Día</label><input id="libres-dia" name="dia" type="date" min="${f}" value="${f}" required></div>
       <div class="campo"><label for="libres">Minutos libres</label><input id="libres" name="libres" type="number" inputmode="numeric" min="0" max="1440" step="5" required></div>
     </div>
     <p class="ayuda" data-plantilla></p>
     <div class="checks"><label><input type="checkbox" name="plantilla" value="1"> Usar mi ${datos.disponibilidad.ciclo ? 'ciclo de turnos' : 'semana normal'} ese día</label></div>`,
    (fd) => {
      const dia = fd.get('dia');
      if (!L.esFechaValida(dia) || dia < f) return 'Elige hoy o un día futuro.';
      if (fd.get('plantilla')) {
        cambiar((d) => delete d.disponibilidad.excepciones[dia], `${etiquetaDia(dia)} usa tu ${datos.disponibilidad.ciclo ? 'ciclo de turnos' : 'semana normal'}.`);
        return;
      }
      const n = Number(fd.get('libres'));
      if (!Number.isInteger(n) || n < 0 || n > 1440) return 'Escribe un número entero de minutos, de 0 a 1440.';
      marcarLibresTutorial();
      cambiar((d) => (d.disponibilidad.excepciones[dia] = n), `${etiquetaDia(dia)}: ${dur(n)} libres.`);
    },
  );
  const $dia = form.querySelector('#libres-dia');
  const actualizar = () => {
    if (!L.esFechaValida($dia.value)) return;
    const ciclo = L.diaDelCiclo(datos.disponibilidad, $dia.value);
    form.querySelector('[data-plantilla]').textContent = ciclo
      ? `Según tu ciclo, ese día es ${nombreDiaCiclo(ciclo)}: ${dur(ciclo.minutos)}.`
      : `Tu semana normal para ese ${NOMBRES_DIA[L.diaSemana($dia.value)].toLowerCase()}: ${dur(L.minutosBase(datos.disponibilidad, $dia.value))}.`;
    form.querySelector('#libres').value = L.minutosLibres(datos.disponibilidad, $dia.value);
  };
  $dia.addEventListener('change', actualizar);
  actualizar();
  form.querySelector('#libres').focus();
}

/** <select> de objetivos de resultado en proyectos activos, agrupados por proyecto. */
function opcionesObjetivos(seleccion = '', { vacio = '' } = {}) {
  const grupos = L.ordenarProyectos(datos, hoy())
    .filter((p) => p.estado === 'activo')
    .map((p) => {
      const objs = L.objetivosVisibles(datos, p.id).filter((o) => o.tipo === 'resultado' && !o.logrado);
      return objs.length ? `<optgroup label="${esc(p.nombre)}">${objs.map((o) => `<option value="${esc(o.id)}"${o.id === seleccion ? ' selected' : ''}>${esc(o.nombre)}</option>`).join('')}</optgroup>` : '';
    })
    .join('');
  return `${vacio ? `<option value="">${esc(vacio)}</option>` : ''}${grupos}`;
}

/** Anotar rápido: una línea, y si quieres, su objetivo. Sin objetivo queda en "Por ordenar". */
function dialogoAnotar() {
  let ultimo = '';
  try {
    ultimo = sessionStorage.getItem('rumbo.ultimoObjetivo') ?? '';
  } catch {
    // sin almacenamiento de sesión: parte sin objetivo sugerido
  }
  abrirDialogo(
    'Anotar rápido',
    `<div class="campo"><label for="a-texto">¿Qué se te ocurrió?</label><input id="a-texto" name="texto" maxlength="300" required autocomplete="off" placeholder="Pedir carta de recomendación a la jefa"></div>
     <div class="campo"><label for="a-objetivo">¿A qué objetivo va? (opcional)</label><select id="a-objetivo" name="objetivoId">${opcionesObjetivos(ultimo, { vacio: 'Decidir después (queda en «Por ordenar»)' })}</select>
       <p class="ayuda">Si lo dejas para después, aparece arriba en Mi día y en tu revisión semanal.</p></div>`,
    (fd) => {
      const texto = String(fd.get('texto') ?? '').trim();
      if (!texto) return 'Escribe qué se te ocurrió.';
      const objetivoId = fd.get('objetivoId');
      if (objetivoId) {
        try {
          sessionStorage.setItem('rumbo.ultimoObjetivo', objetivoId);
        } catch {
          // no pasa nada si no se puede recordar
        }
        const tarea = L.nuevaTarea({ id: crearId(), objetivoId, titulo: texto.slice(0, 300), ...L.TAREA_RAPIDA, creado: hoy() });
        cambiar((d) => d.tareas.push(tarea), `Anotado en "${buscar(datos.objetivos, objetivoId).nombre}".`);
      } else {
        cambiar((d) => d.bandeja.push({ id: crearId(), texto: texto.slice(0, 300), fecha: hoy() }), 'Anotado en «Por ordenar».');
      }
    },
    'Anotar',
  );
}

/** Pasar algo de "Por ordenar" a un objetivo, como tarea. */
function dialogoOrdenar(id) {
  const b = buscar(datos.bandeja, id);
  if (!b) return;
  abrirDialogo(
    'Ordenar lo anotado',
    `<div class="campo"><label for="o-texto">Tarea</label><input id="o-texto" name="texto" maxlength="300" required value="${esc(b.texto)}"></div>
     <div class="campo"><label for="o-destino">Objetivo</label><select id="o-destino" name="objetivoId" required>${opcionesObjetivos()}</select></div>`,
    (fd) => {
      const objetivoId = fd.get('objetivoId');
      const texto = String(fd.get('texto') ?? '').trim();
      if (!objetivoId) return 'Elige un objetivo (o crea uno en tus proyectos).';
      if (!texto) return 'La tarea no puede quedar vacía.';
      const tarea = L.nuevaTarea({ id: crearId(), objetivoId, titulo: texto, ...L.TAREA_RAPIDA, creado: hoy() });
      cambiar((d) => {
        d.bandeja = d.bandeja.filter((x) => x.id !== id);
        d.tareas.push(tarea);
      }, `Ahora es una tarea de "${buscar(datos.objetivos, objetivoId).nombre}".`);
    },
    'Guardar como tarea',
  );
}

/** Mover el plazo de una tarea u objetivo (por defecto, una semana desde hoy). */
function dialogoMoverPlazo(valor) {
  const [tipo, id] = valor.split('|');
  const x = buscar(tipo === 'tarea' ? datos.tareas : datos.objetivos, id);
  const nombre = x.titulo ?? x.nombre;
  abrirDialogo(
    `Nuevo plazo para "${nombre}"`,
    `<p class="ayuda">Mover un plazo no es fallar: es ajustar el plan a lo que de verdad pasó.</p>
     <div class="campo"><label for="np-fecha">Nuevo plazo</label><input id="np-fecha" name="fecha" type="date" min="${hoy()}" value="${L.sumarDias(hoy(), 7)}" required></div>`,
    (fd) => {
      const fecha = fd.get('fecha');
      if (!L.esFechaValida(fecha) || fecha < hoy()) return 'Elige hoy o un día futuro.';
      cambiar((d) => (buscar(tipo === 'tarea' ? d.tareas : d.objetivos, id).plazo = fecha), `Nuevo plazo: ${fechaCorta(fecha)}.`);
    },
    'Mover plazo',
  );
}

/** Tu momento Rumbo: cuándo y dónde lo abrirás cada día (intención de implementación). */
function dialogoMomento() {
  abrirDialogo(
    'Tu momento Rumbo',
    `<p class="ayuda">Rumbo no manda notificaciones: funciona si lo abres a la misma hora y en el mismo lugar. Decidir de antemano "cuándo y dónde" ayuda a cumplir lo que te propones (Gollwitzer y Sheeran, 2006, metaanálisis).</p>
     <div class="campo"><label for="m-texto">Cuándo y dónde</label><input id="m-texto" name="momento" maxlength="120" value="${esc(datos.meta.momento)}" placeholder="Al llegar a casa después del turno, 21:00"></div>
     <p class="ayuda">Tip: instálalo en la pantalla de inicio de tu teléfono para que esté a un toque.</p>`,
    (fd) => {
      const momento = String(fd.get('momento') ?? '').trim().slice(0, 120);
      cambiar((d) => (d.meta.momento = momento), momento ? 'Momento Rumbo guardado.' : 'Momento Rumbo quitado.');
    },
    'Guardar',
  );
}

/** Todo lo anotado como "falta algo", para resolverlo desde un solo lugar. */
function dialogoFaltantes() {
  const objetivos = new Map(datos.objetivos.map((o) => [o.id, o]));
  const proyectos = new Map(datos.proyectos.map((p) => [p.id, p]));
  const lista = datos.notas.filter((n) => n.falta).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const form = abrirDialogo(
    'Lo que anotaste que falta',
    lista.length
      ? `<p class="ayuda">Márcalo resuelto cuando esté listo. Mientras siga pendiente, su tarea sube en tus recomendaciones.</p>
         <div data-faltantes>${lista
           .map((n) => {
             const o = objetivos.get(n.objetivoId);
             const t = n.tareaId ? buscar(datos.tareas, n.tareaId) : null;
             return `<p class="ayuda donde-nota">${esc(proyectos.get(o?.proyectoId)?.nombre ?? '')} · ${esc(t?.titulo ?? o?.nombre ?? '')}</p>${notasHtml([n])}`;
           })
           .join('')}</div>`
      : '<p class="vacio">No tienes nada anotado como pendiente.</p>',
    () => {},
    'Cerrar',
  );
  form.querySelector('button[type=submit]').remove();
}

/** Revisión semanal en 3 pasos: lo logrado, lo que quedó (vencido, olvidado, por ordenar) y el foco de la semana. */
function dialogoRevision() {
  const f = hoy();
  const r = L.resumenSemana(datos, f);
  const foco = L.focoDeLaSemana(datos, f);
  const proyectos = new Map(datos.proyectos.map((p) => [p.id, p]));
  const max = Math.max(1, ...r.minutosPorDia.map((x) => x.minutos));
  const semana = !r.minutos ? '' : `<div class="semana-barras" aria-label="Minutos por día, últimos 7 días">${r.minutosPorDia
    .map((x) => `<div class="dia-barra"><span class="dia-barra-valor" style="height:${Math.round((x.minutos / max) * 100)}%"></span><span class="dia-barra-etiqueta">${NOMBRES_DIA[L.diaSemana(x.fecha)].slice(0, 2)}</span></div>`)
    .join('')}</div>`;
  const form = abrirDialogo(
    'Tu revisión semanal',
    `<h3 class="subtitulo">1 · Lo que lograste en 7 días</h3>
     <p><strong>${dur(r.minutos)}</strong> dedicados · <strong>${plural(r.terminadas.length, 'tarea terminada', 'tareas terminadas')}</strong></p>
     ${semana}
     ${r.terminadas.length ? `<ul class="ayuda">${r.terminadas.slice(0, 12).map((t) => `<li>✓ ${esc(t.titulo)}</li>`).join('')}</ul>` : '<p class="ayuda">Esta semana no terminaste tareas. Pasa: lo importante es volver a elegir.</p>'}

     <h3 class="subtitulo">2 · Lo que quedó</h3>
     ${r.vencidos.length ? `<ul class="lista-revision">${r.vencidos
       .map((x) => `<li><span><strong>${esc(x.nombre)}</strong> <span class="ayuda">· venció el ${esc(fechaCorta(x.fecha))}</span></span><span class="acciones-nota">
         ${boton('mover-plazo', 'Mover', { id: `${x.tipo}|${x.id}`, clase: 'chico', etiqueta: `Mover plazo: ${x.nombre}` })}
         ${boton('quitar-plazo', 'Quitar', { id: `${x.tipo}|${x.id}`, clase: 'chico plano', etiqueta: `Quitar plazo: ${x.nombre}` })}</span></li>`)
       .join('')}</ul>` : '<p class="ayuda">Nada vencido. Bien.</p>'}
     ${r.enRiesgo.length ? `<p class="ayuda"><strong>No llegas a su plazo al ritmo de esta semana:</strong></p><ul class="lista-revision">${r.enRiesgo
       .map((x) => `<li><span><strong>${esc(x.objetivo.nombre)}</strong> <span class="ayuda">· plazo ${esc(fechaCorta(x.objetivo.plazo))}, falta ${Math.round(x.riesgo.falta * 100)}%</span></span><span class="acciones-nota">
         ${boton('mover-plazo', 'Mover', { id: `objetivo|${x.objetivo.id}`, clase: 'chico', etiqueta: `Mover plazo: ${x.objetivo.nombre}` })}</span></li>`)
       .join('')}</ul>` : ''}
     ${r.olvidados.length ? `<p class="ayuda">Sin avance hace 7 días o más: ${r.olvidados.map((p) => esc(p.nombre)).join(', ')}. Si no es su momento, pausarlo (en Editar proyecto) también es decidir.</p>` : ''}
     ${r.porOrdenar ? `<p class="ayuda">Tienes ${plural(r.porOrdenar, 'cosa', 'cosas')} en «Por ordenar»: están arriba en Mi día.</p>` : ''}

     <h3 class="subtitulo">3 · Tu foco de la semana</h3>
     <p class="ayuda">Elige hasta 3 objetivos. Rumbo los priorizará esta semana.</p>
     <fieldset class="checks columna foco">${r.objetivosActivos.length
       ? r.objetivosActivos
         .map((o) => `<label><input type="checkbox" name="foco" value="${esc(o.id)}"${foco.has(o.id) ? ' checked' : ''}> ${esc(o.nombre)} <span class="ayuda">· ${esc(proyectos.get(o.proyectoId)?.nombre ?? '')}</span></label>`)
         .join('')
       : '<p class="ayuda">Aún no tienes objetivos activos.</p>'}</fieldset>`,
    (fd) => {
      const elegidos = fd.getAll('foco');
      if (elegidos.length > 3) return 'Elige como máximo 3: foco es elegir pocas cosas.';
      cambiar((d) => {
        d.foco = { semana: L.inicioSemana(f), objetivos: elegidos };
        d.meta.ultimaRevision = f;
      }, elegidos.length ? `Revisión lista. Foco: ${plural(elegidos.length, 'objetivo', 'objetivos')}.` : 'Revisión lista.');
    },
    'Terminar revisión',
  );
  // Tras mover o quitar un plazo desde la revisión, se vuelve a abrir con los datos al día.
  form.dataset.revision = '1';
}

/** Ideas de OBJETIVOS para un proyecto: consejos + copiar/pegar con Claude; cada idea se agrega por separado. */
function dialogoIdeasObjetivos(proyectoId) {
  const p = buscar(datos.proyectos, proyectoId);
  ideasObjetivos = { proyectoId, lista: [], agregadas: new Set() };
  const form = abrirDialogo(
    `Ideas de objetivos para "${p.nombre}"`,
    `${consejosHtml('objetivo')}
     <ol class="instrucciones">
       <li>Revisa y copia este texto. Es lo único que compartes.</li>
       <li>Pégalo en Claude o ChatGPT (tu plan normal, sin costo extra).</li>
       <li>Pega aquí la respuesta completa y agrega los objetivos que te sirvan.</li>
     </ol>
     <div class="campo"><label for="ia-texto">Texto para copiar</label><textarea id="ia-texto" readonly rows="7">${esc(L.textoIdeasObjetivos(datos, p))}</textarea>
       <div class="fila-botones">${boton('copiar-ia', 'Copiar texto', { clase: 'chico' })}</div></div>
     <div class="campo"><label for="ia-respuesta">Respuesta de la IA</label><textarea id="ia-respuesta" name="respuesta" rows="5" placeholder='{"objetivos":[...]}'></textarea></div>`,
    (fd, f) => {
      const r = L.leerIdeasObjetivos(String(fd.get('respuesta') ?? ''));
      ideasObjetivos.lista = r.ideas;
      ideasObjetivos.agregadas = new Set();
      pintarIdeasObjetivos(f, r.errores);
      return r.ok ? false : r.errores.at(-1);
    },
    'Revisar ideas',
  );
  form.querySelector('#ia-texto').focus();
}

function pintarIdeasObjetivos(form, errores = []) {
  const x = ideasObjetivos;
  form.querySelector('[data-extra]').innerHTML = `
    ${x.lista.length ? `<h3 class="subtitulo">Objetivos propuestos (${x.lista.length})</h3><ul class="lista">${x.lista
      .map(
        (o, i) => `<li class="idea"><div class="item-cabeza"><strong>${esc(o.nombre)}</strong><span class="chip">${o.tipo === 'tiempo' ? 'Tiempo' : 'Resultado'}</span></div>
          ${o.criterio ? `<p class="ayuda">Meta: ${esc(o.criterio)}</p>` : ''}
          ${o.tipo === 'tiempo' ? `<p class="ayuda">${dur(o.minutosMeta)} por semana</p>` : o.tareas.length ? `<p class="ayuda">Tareas: ${o.tareas.map((t) => esc(t.titulo)).join(' · ')}</p>` : ''}
          ${x.agregadas.has(i) ? '<p class="ok">Agregado ✓</p>' : boton('agregar-idea-objetivo', 'Agregar objetivo', { id: String(i), clase: 'chico primario', etiqueta: `Agregar objetivo: ${o.nombre}` })}</li>`,
      )
      .join('')}</ul>` : ''}
    ${errores.length && x.lista.length ? `<details class="porque"><summary>Descarté ${plural(errores.length, 'idea o aviso', 'ideas o avisos')}</summary><ul>${errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}`;
}

function dialogoIdeas(objetivoId) {
  const o = buscar(datos.objetivos, objetivoId);
  const p = proyectoDeObjetivo(o);
  const texto = L.textoParaIdeas(datos, p, o);
  ideas = { objetivoId, lista: [], agregadas: new Set() };
  const form = abrirDialogo(
    `Ideas para "${o.nombre}"`,
    `<ol class="instrucciones">
       <li>Revisa y copia este texto. Es lo único que compartes.</li>
       <li>Pégalo en Claude o ChatGPT (tu plan normal, sin costo extra).</li>
       <li>Pega aquí la respuesta completa y revisa las ideas una por una.</li>
     </ol>
     <div class="campo"><label for="ia-texto">Texto para copiar</label><textarea id="ia-texto" readonly rows="7">${esc(texto)}</textarea>
       <div class="fila-botones">${boton('copiar-ia', 'Copiar texto', { clase: 'chico' })}</div></div>
     <div class="campo"><label for="ia-respuesta">Respuesta de la IA</label><textarea id="ia-respuesta" name="respuesta" rows="5" placeholder='{"tareas":[...]}'></textarea></div>`,
    (fd, f) => {
      const r = L.leerIdeas(String(fd.get('respuesta') ?? ''));
      ideas.lista = r.ideas;
      ideas.agregadas = new Set();
      pintarIdeas(f, r.errores);
      return r.ok ? false : r.errores.at(-1);
    },
    'Revisar ideas',
  );
  form.querySelector('#ia-texto').focus();
}

function pintarIdeas(form, errores = []) {
  const $extra = form.querySelector('[data-extra]');
  $extra.innerHTML = `
    ${ideas.lista.length ? `<h3 class="subtitulo">Ideas (${ideas.lista.length})</h3><ul class="lista">${ideas.lista
      .map(
        (x, i) => `<li class="idea"><div class="item-cabeza"><strong>${esc(x.titulo)}</strong>${chipTamano(x.tamano)}</div>
          <p class="ayuda">${dur(x.minutos)}${x.pasos.length ? ` · ${plural(x.pasos.length, 'paso', 'pasos')}: ${x.pasos.map(esc).join(' · ')}` : ''}</p>
          ${ideas.agregadas.has(i) ? '<p class="ok">Agregada ✓</p>' : boton('agregar-idea', 'Agregar', { id: String(i), clase: 'chico primario', etiqueta: `Agregar idea: ${x.titulo}` })}</li>`,
      )
      .join('')}</ul>` : ''}
    ${errores.length && ideas.lista.length ? `<details class="porque"><summary>Descarté ${plural(errores.length, 'idea o aviso', 'ideas o avisos')}</summary><ul>${errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}`;
}

// ---------- Respaldo ----------

function exportar() {
  const f = hoy();
  const url = URL.createObjectURL(new Blob([L.exportarTexto(datos, f)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `rumbo-respaldo-${f}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  datos = { ...datos, meta: { ...datos.meta, ultimoRespaldo: f } };
  persistir(datos);
  render();
  avisar('Respaldo descargado. Guárdalo fuera de este equipo (por ejemplo, en tu Drive).');
}

async function importar(archivo) {
  erroresImportacion = [];
  if (archivo.size > 5_000_000) {
    erroresImportacion = ['El archivo pesa más de 5 MB; no parece un respaldo de Rumbo.'];
    return render();
  }
  const r = L.importarTexto(await archivo.text(), hoy());
  if (!r.ok) {
    erroresImportacion = r.errores;
    return render();
  }
  const ok = confirm(
    `Importar "${archivo.name}": ${plural(r.datos.proyectos.length, 'proyecto', 'proyectos')}, ${plural(r.datos.objetivos.length, 'objetivo', 'objetivos')} y ${plural(r.datos.tareas.length, 'tarea', 'tareas')}.\n\n` +
      'Esto reemplaza tus datos actuales. Antes guardo una copia automática que puedes restaurar desde Ajustes.',
  );
  if (!ok) return;
  reemplazarDatos(r.datos, 'Respaldo importado. Tu versión anterior quedó como copia previa.');
}

function reemplazarDatos(nuevos, mensaje) {
  guardarCopiaPrevia(datos, new Date().toISOString());
  datos = nuevos;
  deshacerTexto = null;
  persistir(datos);
  render();
  avisar(mensaje);
}

function restaurarCopia() {
  const copia = leerCopiaPrevia();
  const r = copia ? L.importarTexto(JSON.stringify(copia.datos), hoy()) : { ok: false, errores: ['No hay copia previa.'] };
  if (!r.ok) {
    erroresImportacion = r.errores;
    return render();
  }
  if (!confirm('¿Restaurar la copia previa? Tus datos actuales quedarán a su vez como copia previa.')) return;
  reemplazarDatos(r.datos, 'Copia previa restaurada.');
}

// ---------- Acciones ----------

function tituloPaso(d, tareaId) {
  return buscar(d.tareas, tareaId).titulo;
}

const acciones = {
  // Hoy
  aceptar: (clave) => {
    const v = L.vistaHoy(datos, hoy(), { ignorarCapacidad: verIgualEl === hoy() });
    const r = [...v.recomendaciones, v.extra].find((x) => x?.clave === clave);
    if (!r) return;
    cambiar((d) => {
      planEditable(d).items.push({ id: crearId(), tipo: r.tipo, tareaId: r.tarea?.id ?? null, objetivoId: r.objetivo.id, minutos: r.minutos, hecho: false });
    }, 'Agregado a tu plan de hoy.');
  },
  otra: (clave) => cambiar((d) => planEditable(d).descartadas.push(clave), 'Te muestro otra.'),
  'ver-igual': () => {
    verIgualEl = hoy();
    render();
  },
  'item-hecho': (id) => {
    const item = L.planDeHoy(datos, hoy()).items.find((i) => i.id === id);
    cambiar((d) => completarItem(d, id, item.minutos), `Registraste ${dur(item.minutos)}.`, { celebrar: proyectoDe(item) });
  },
  'item-cantidad': (id) => {
    const item = L.planDeHoy(datos, hoy()).items.find((i) => i.id === id);
    dialogoMinutos('¿Cuántos minutos le dedicaste?', item.minutos, (m) => cambiar((d) => completarItem(d, id, m), `Registraste ${dur(m)}.`, { celebrar: proyectoDe(item) }));
  },
  'item-quitar': (id) => cambiar((d) => {
    const plan = planEditable(d);
    plan.items = plan.items.filter((i) => i.id !== id);
  }, 'Quitado de tu plan.'),
  'editar-libres': () => dialogoLibres(),
  'editar-ciclo': () => dialogoCiclo(),
  'quitar-ciclo': () => cambiar((d) => (d.disponibilidad.ciclo = null), 'Volviste a tu semana fija.'),
  'registrar-tiempo': () => dialogoRegistrar(),
  'quitar-excepcion': (f) => cambiar((d) => delete d.disponibilidad.excepciones[f], `${etiquetaDia(f)} vuelve a tu ${datos.disponibilidad.ciclo ? 'ciclo de turnos' : 'semana normal'}.`),

  // Proyectos
  'nuevo-proyecto': () => dialogoProyecto(),
  'editar-proyecto': (id) => dialogoProyecto(buscar(datos.proyectos, id)),
  'cargar-ejemplo': () => {
    const e = proyectoEjemplo(hoy(), crearId);
    cambiar((d) => {
      d.proyectos.push(e.proyecto);
      d.objetivos.push(...e.objetivos);
      d.tareas.push(...e.tareas);
      d.registros.push(...e.registros);
      d.notas.push(...e.notas);
    }, 'Proyecto de ejemplo agregado.');
    location.hash = `#/proyecto/${encodeURIComponent(e.proyecto.id)}`;
  },

  // Objetivos
  'nuevo-objetivo': (proyectoId) => dialogoObjetivo(proyectoId),
  'editar-objetivo': (id) => dialogoObjetivo(null, buscar(datos.objetivos, id)),
  logrado: (id) => cambiar((d) => {
    const o = buscar(d.objetivos, id);
    o.logrado = !o.logrado;
    o.logradoEl = o.logrado ? hoy() : null;
  }, buscar(datos.objetivos, id).logrado ? 'Objetivo reabierto.' : 'Objetivo logrado.', { celebrar: proyectoDe({ objetivoId: id }) }),
  'borrar-objetivo': (id) => {
    const o = buscar(datos.objetivos, id);
    const n = L.tareasDe(datos, id).length;
    const anterior = o.anteriorId ? buscar(datos.objetivos, o.anteriorId) : null;
    const extra = anterior ? `\n\nLa etapa anterior ("${anterior.nombre}") vuelve a quedar visible.` : '';
    if (!confirm(`¿Borrar el objetivo "${o.nombre}"${n ? ` y ${plural(n, 'su tarea', `sus ${n} tareas`)}` : ''} con sus notas? Podrás deshacerlo justo después.${extra}`)) return;
    cambiar((d) => {
      const tareas = new Set(L.tareasDe(d, id).map((t) => t.id));
      d.objetivos = d.objetivos.filter((x) => x.id !== id);
      d.tareas = d.tareas.filter((t) => !tareas.has(t.id));
      limpiarReferencias(d, { tareas, objetivos: new Set([id]) });
      // Borrar una etapa deja a la vista la anterior, para no perderla dentro de algo que ya no existe.
      if (anterior) buscar(d.objetivos, anterior.id).archivado = false;
    }, `Objetivo "${o.nombre}" borrado.`);
  },
  ampliar: (id) => dialogoObjetivo(null, null, false, buscar(datos.objetivos, id)),
  'sumar-tiempo': (valor) => {
    const [id, m] = valor.split('|');
    const o = buscar(datos.objetivos, id);
    cambiar((d) => d.registros.push({ id: crearId(), fecha: hoy(), minutos: Number(m), objetivoId: id, tareaId: null }), `Registraste ${m} min en "${o.nombre}".`, { celebrar: o.proyectoId });
  },
  'otra-cantidad': (id) => {
    const o = buscar(datos.objetivos, id);
    dialogoMinutos(`Registrar tiempo en "${o.nombre}"`, 45, (m) =>
      cambiar((d) => d.registros.push({ id: crearId(), fecha: hoy(), minutos: m, objetivoId: id, tareaId: null }), `Registraste ${dur(m)} en "${o.nombre}".`, { celebrar: o.proyectoId }),
    );
  },
  ideas: (id) => dialogoIdeas(id),
  'ideas-objetivos': (proyectoId) => dialogoIdeasObjetivos(proyectoId),
  'agregar-idea-objetivo': (i) => {
    const idea = ideasObjetivos?.lista[Number(i)];
    if (!idea || ideasObjetivos.agregadas.has(Number(i))) return;
    const objetivo = L.nuevoObjetivo({
      id: crearId(), proyectoId: ideasObjetivos.proyectoId, nombre: idea.nombre, criterio: idea.criterio, tipo: idea.tipo,
      minutosMeta: idea.minutosMeta, periodo: idea.periodo, creado: hoy(),
    });
    const tareas = idea.tareas.map((t) => L.nuevaTarea({
      id: crearId(), objetivoId: objetivo.id, titulo: t.titulo, tamano: t.tamano, minutos: t.minutos, creado: hoy(),
      pasos: t.pasos.map((texto) => ({ id: crearId(), texto, hecho: false })),
    }));
    const errores = L.erroresObjetivo(objetivo, new Set(datos.proyectos.map((p) => p.id)));
    if (errores.length) return avisar(textoErrores(errores));
    cambiar((d) => {
      d.objetivos.push(objetivo);
      d.tareas.push(...tareas);
    }, `Objetivo "${idea.nombre}" agregado${tareas.length ? ` con ${plural(tareas.length, 'tarea', 'tareas')}` : ''}.`);
    ideasObjetivos.agregadas.add(Number(i));
    pintarIdeasObjetivos($dialogo.querySelector('form'));
  },
  'ver-plantillas': () => dialogoPlantillas(),
  'usar-plantilla': (id) => dialogoProyecto(null, PLANTILLAS.find((pl) => pl.id === id)),
  tema: () => aplicarTema(esOscuro() ? 'claro' : 'oscuro'),

  // Anotar rápido y "Por ordenar"
  anotar: () => dialogoAnotar(),
  ordenar: (id) => dialogoOrdenar(id),
  'descartar-bandeja': (id) => cambiar((d) => (d.bandeja = d.bandeja.filter((x) => x.id !== id)), 'Descartado.'),

  // Plazos vencidos (desde Mi día o desde la revisión semanal)
  'mover-plazo': (valor) => {
    const desdeRevision = !!$dialogo.querySelector('form[data-revision]');
    dialogoMoverPlazo(valor);
    if (desdeRevision) $dialogo.querySelector('form').dataset.volverRevision = '1';
  },
  'quitar-plazo': (valor) => {
    const [tipo, id] = valor.split('|');
    const desdeRevision = !!$dialogo.querySelector('form[data-revision]');
    cambiar((d) => (buscar(tipo === 'tarea' ? d.tareas : d.objetivos, id).plazo = null), 'Plazo quitado.');
    if (desdeRevision) dialogoRevision();
  },

  // Regreso, revisión, momento y números
  'cerrar-regreso': () => {
    bienvenidaVista = true;
    render();
  },
  revision: () => dialogoRevision(),
  momento: () => dialogoMomento(),
  'ver-semana': () => (location.hash = `#/dia/${L.sumarDias(hoy(), -1)}`),
  'ver-faltantes': () => dialogoFaltantes(),

  // Orden de las tareas dentro de su objetivo
  'tarea-subir': (id) => cambiar((d) => L.moverEnOrden(d, id, -1)),
  'tarea-bajar': (id) => cambiar((d) => L.moverEnOrden(d, id, 1)),
  'copiar-ia': async () => {
    const $t = $dialogo.querySelector('#ia-texto');
    try {
      await navigator.clipboard.writeText($t.value);
    } catch {
      $t.select();
      document.execCommand('copy');
    }
    avisar('Texto copiado. Pégalo en Claude o ChatGPT.');
  },
  'agregar-idea': (i) => {
    const idea = ideas?.lista[Number(i)];
    if (!idea || ideas.agregadas.has(Number(i))) return;
    const tarea = L.nuevaTarea({
      id: crearId(), objetivoId: ideas.objetivoId, titulo: idea.titulo, tamano: idea.tamano, minutos: idea.minutos,
      pasos: idea.pasos.map((texto) => ({ id: crearId(), texto, hecho: false })), creado: hoy(),
    });
    const errores = L.erroresTarea(tarea, new Map(datos.objetivos.map((x) => [x.id, x])));
    if (errores.length) return avisar(textoErrores(errores));
    cambiar((d) => {
      d.tareas.push(tarea);
      L.reabrirSiPendiente(d, tarea.objetivoId);
    }, `Tarea "${idea.titulo}" agregada.`);
    ideas.agregadas.add(Number(i));
    pintarIdeas($dialogo.querySelector('form'));
  },

  // Tareas
  'nueva-tarea': (objetivoId) => dialogoTarea(objetivoId),
  'editar-tarea': (id) => dialogoTarea(null, buscar(datos.tareas, id)),
  'borrar-tarea': (id) => cambiar((d) => {
    d.tareas = d.tareas.filter((t) => t.id !== id);
    limpiarReferencias(d, { tareas: new Set([id]) });
  }, 'Tarea borrada.'),
  'terminar-tarea': (id) => cambiar((d) => marcarTerminada(d, buscar(d.tareas, id)), 'Tarea terminada.', { celebrar: proyectoDe({ tareaId: id }) }),
  'reabrir-tarea': (id) => cambiar((d) => {
    const t = buscar(d.tareas, id);
    t.hecha = false;
    t.hechaEl = null;
    L.reabrirSiPendiente(d, t.objetivoId);
  }, 'Tarea reabierta.'),

  // Notas
  'nota-tarea': (id) => {
    const t = buscar(datos.tareas, id);
    dialogoNota({ objetivoId: t.objetivoId, tareaId: id, fecha: hoy(), titulo: `Nota en "${t.titulo}"` });
  },
  'nota-objetivo': (id) => dialogoNota({ objetivoId: id, tareaId: null, fecha: hoy(), titulo: `Nota en "${buscar(datos.objetivos, id).nombre}"` }),
  'nota-item': (valor) => {
    const [fecha, itemId] = valor.split('|');
    const item = L.planDeHoy(datos, fecha).items.find((i) => i.id === itemId);
    const nombre = item.tareaId ? buscar(datos.tareas, item.tareaId).titulo : buscar(datos.objetivos, item.objetivoId).nombre;
    dialogoNota({ objetivoId: item.objetivoId, tareaId: item.tareaId ?? null, fecha, titulo: `¿Cómo te fue con "${nombre}"?` });
  },
  'nota-resuelta': (id) => {
    cambiar((d) => (buscar(d.notas, id).falta = false), 'Marcado como resuelto.');
    if ($dialogo.open && $dialogo.querySelector('[data-faltantes]')) dialogoFaltantes();
  },
  'borrar-nota': (id) => {
    cambiar((d) => (d.notas = d.notas.filter((n) => n.id !== id)), 'Nota borrada.');
    if ($dialogo.open && $dialogo.querySelector('[data-faltantes]')) dialogoFaltantes();
  },
  'a-plan': (id) => {
    const t = buscar(datos.tareas, id);
    cambiar((d) => planEditable(d).items.push({ id: crearId(), tipo: 'tarea', tareaId: id, objetivoId: t.objetivoId, minutos: L.minutosSesion(t, datos), hecho: false }), 'Agregada a tu plan de hoy.');
  },
  'pasos-base': (id) => {
    abiertas.add(id);
    cambiar((d) => (buscar(d.tareas, id).pasos = L.PASOS_BASE.map((texto) => ({ id: crearId(), texto, hecho: false }))), 'Pasos base agregados. Edítalos a tu medida.');
  },
  'rellenar-pasos-base': () => {
    const $p = $dialogo.querySelector('#t-pasos');
    $p.value = [$p.value.trim(), ...L.PASOS_BASE].filter(Boolean).join('\n');
    $p.focus();
  },

  // Respaldo y varios
  exportar: () => exportar(),
  'restaurar-copia': () => restaurarCopia(),
  deshacer: () => deshacer(),
  'cerrar-dialogo': () => $dialogo.close(),
  'ir-a': (id) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
  },
  'cerrar-aviso': () => {
    avisoCarga = null;
    render();
  },
  'reintentar-guardar': () => {
    const ok = persistir(datos);
    render();
    avisar(ok ? 'Listo: tus cambios quedaron guardados.' : 'Sigue sin poder guardar. Descarga un respaldo para no perder lo de hoy.', false, ok ? '' : 'error');
  },

  // ¿Qué es esto?
  clasificar: () => dialogoClasificar(),
  'clasificar-bandeja': (id) => {
    const b = buscar(datos.bandeja, id);
    if (b) dialogoClasificar(b.texto, b.id);
  },
  'clasif-responder': (valor) => {
    clasif.respuestas.push(valor === 'si');
    pintarClasificar();
  },
  'clasif-atras': () => {
    clasif.respuestas.pop();
    pintarClasificar();
  },
  'clasif-otra': () => dialogoClasificar(),
  'clasif-crear': () => crearDesdeClasificar(),
  'clasif-crear-proyecto-para': () => {
    const paso = L.pasoClasificar(clasif.respuestas);
    dialogoProyecto(null, null, {
      objetivo: { nombre: clasif.texto, tipo: paso.id === 'objetivo-tiempo' ? 'tiempo' : 'resultado', alCrear: sacarDeBandeja(clasif.bandejaId) },
    });
  },
  'clasif-por-ordenar': () => {
    const texto = clasif.texto;
    $dialogo.close();
    cambiar((d) => d.bandeja.push({ id: crearId(), texto, fecha: hoy() }), 'Quedó en «Por ordenar», arriba en Mi día.');
  },
  'clasif-quitar': () => {
    const quitar = sacarDeBandeja(clasif.bandejaId);
    $dialogo.close();
    cambiar(quitar, 'Sacado de «Por ordenar».');
  },

  // Tutorial
  'tutorial-empezar': () => {
    avancePrevio = null;
    irACuadro(0);
  },
  'tutorial-siguiente': () => irACuadro(tutorial.cuadro + 1, { saltarHechos: true }),
  'tutorial-anterior': () => irACuadro(tutorial.cuadro - 1),
  'tutorial-mostrar': () => mostrarDondeTutorial(),
  'tutorial-ocultar': () => {
    guardarTutorial({ estado: 'minimizado' });
    pintarTutorial();
  },
  'tutorial-abrir': () => {
    guardarTutorial({ estado: 'activo' });
    pintarTutorial();
  },
  'tutorial-salir': () => {
    guardarTutorial({ estado: 'cerrado' });
    pintarTutorial();
    avisar('Tutorial cerrado. Lo puedes retomar cuando quieras desde la Guía.');
  },
  'tutorial-terminar': () => {
    guardarTutorial({ estado: 'terminado' });
    pintarTutorial();
    avisar('¡Bien hecho! La Guía queda en el menú por si la necesitas.', false, 'grande');
  },
  'tutorial-libres-ok': () => {
    marcarLibresTutorial();
    seguirTutorial();
    pintarTutorial();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el || el.disabled) return;
  const accion = acciones[el.dataset.accion];
  if (!accion) return;
  e.preventDefault();
  accion(el.dataset.id, el);
});

// Borrar un proyecto va aparte porque además navega.
acciones['borrar-proyecto'] = (id) => {
  const p = buscar(datos.proyectos, id);
  if (!confirm(`¿Borrar "${p.nombre}" con todos sus objetivos, tareas y tiempo registrado? Podrás deshacerlo justo después.`)) return;
  location.hash = '#/proyectos';
  cambiar((d) => {
    const objetivos = new Set(L.objetivosDe(d, id).map((o) => o.id));
    const tareas = new Set(d.tareas.filter((t) => objetivos.has(t.objetivoId)).map((t) => t.id));
    d.proyectos = d.proyectos.filter((x) => x.id !== id);
    d.objetivos = d.objetivos.filter((o) => !objetivos.has(o.id));
    d.tareas = d.tareas.filter((t) => !tareas.has(t.id));
    limpiarReferencias(d, { tareas, objetivos });
  }, `Proyecto "${p.nombre}" borrado.`);
};

const formularios = {
  paso: (fd, form) => {
    const texto = String(fd.get('texto') ?? '').trim();
    if (!texto) return;
    const id = form.dataset.id;
    abiertas.add(id);
    cambiar((d) => {
      const t = buscar(d.tareas, id);
      if (t.pasos.length >= 50) return;
      t.pasos.push({ id: crearId(), texto: texto.slice(0, 300), hecho: false });
    });
    $main.querySelector(`#paso-${CSS.escape(id)}`)?.focus();
  },
  disponibilidad: (fd) => {
    const plantilla = [0, 1, 2, 3, 4, 5, 6].map((i) => Number(fd.get(`d${i}`)));
    if (!plantilla.every((m) => Number.isInteger(m) && m >= 0 && m <= 1440)) return 'Cada día debe tener minutos enteros de 0 a 1440.';
    marcarLibresTutorial();
    cambiar((d) => (d.disponibilidad.plantilla = plantilla), 'Minutos libres guardados.');
  },
};

$main.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const error = formularios[form.dataset.form](new FormData(form), form);
  if (error) {
    const $e = form.querySelector('[data-error]');
    if ($e) {
      $e.textContent = error;
      $e.hidden = false;
    } else avisar(error);
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.name === 'tema-app') {
    aplicarTema(el.value);
    return;
  }
  if (el.matches('[data-importar]')) {
    const archivo = el.files?.[0];
    el.value = '';
    if (archivo) importar(archivo);
    return;
  }
  if (el.matches('[data-paso]')) {
    const tareaId = el.dataset.paso;
    const pasoId = el.dataset.pasoId;
    const marcado = el.checked;
    let terminada = false;
    $toast.hidden = true; // así no se mezcla con un aviso anterior
    cambiar((d) => {
      const t = buscar(d.tareas, tareaId);
      const paso = buscar(t.pasos, pasoId);
      paso.hecho = marcado;
      paso.hechoEl = marcado ? hoy() : null;
      t.tocado = hoy();
      if (t.pasos.every((p) => p.hecho) && !t.hecha) {
        marcarTerminada(d, t);
        terminada = true;
      } else if (!marcado && t.hecha) {
        t.hecha = false;
        L.reabrirSiPendiente(d, t.objetivoId);
      }
    }, terminada ? '' : null, { celebrar: marcado ? proyectoDe({ tareaId }) : null });
    if (terminada) {
      // Junta "tarea terminada" con la celebración que ya se mostró (avance del proyecto u objetivo logrado).
      const grande = $toast.classList.contains('toast-grande');
      const celebrado = $toast.hidden ? '' : ($toast.querySelector('span:not(.toast-icono)')?.textContent ?? '');
      const base = `Tarea "${tituloPaso(datos, tareaId)}" terminada: completaste todos sus pasos.`;
      avisar(grande ? `${celebrado} ${base}` : `${base} ${celebrado}`.trim(), true, grande ? 'grande' : 'avance');
    }
  }
});

// Recordar qué tareas están desplegadas para que no se cierren al redibujar.
document.addEventListener(
  'toggle',
  (e) => {
    const id = e.target.dataset?.tareaId ?? e.target.dataset?.abierto;
    if (!id) return;
    if (e.target.open) abiertas.add(id);
    else abiertas.delete(id);
  },
  true,
);

window.addEventListener('hashchange', () => {
  const mostrar = mostrarAlPintar; // «Muéstrame dónde» del tutorial: se muestra después de volver arriba
  render();
  $main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (mostrar) {
    mostrarAlPintar = true;
    pintarTutorial();
  }
});

// Si la app queda abierta y cambia el día, se redibuja al volver.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && hoy() !== diaRenderizado) render();
});

// Otra pestaña cambió los datos: recargar para no pisarlos.
window.addEventListener('storage', (e) => {
  if (e.key === 'rumbo.datos') location.reload();
});

render();
actualizarBotonTema();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
