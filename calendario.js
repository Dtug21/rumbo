// calendario.js — llevar tus plazos y recordatorios a tu calendario (Google, Apple, Outlook…) con un archivo .ics.
// Rumbo no manda notificaciones; tu calendario sí. Funciones puras (sin DOM): se prueban con Node.

const dos = (n) => String(n).padStart(2, '0');
const sinGuiones = (fecha) => fecha.replaceAll('-', '');
const sumarUnDia = (fecha) => {
  const [a, m, d] = fecha.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + 1));
  return `${x.getUTCFullYear()}-${dos(x.getUTCMonth() + 1)}-${dos(x.getUTCDate())}`;
};
/** Fecha y hora flotante (la hora de tu reloj, sin zona): «2026-10-05», «09:00» → 20261005T090000. */
const flotante = (fecha, hora) => `${sinGuiones(fecha)}T${hora.replace(':', '')}00`;
const sumarMinutos = (hora, minutos) => {
  const [h, m] = hora.split(':').map(Number);
  const t = Math.min(24 * 60 - 1, h * 60 + m + minutos);
  return `${dos(Math.floor(t / 60))}:${dos(t % 60)}`;
};
const utc = (fecha) => `${fecha.getUTCFullYear()}${dos(fecha.getUTCMonth() + 1)}${dos(fecha.getUTCDate())}T${dos(fecha.getUTCHours())}${dos(fecha.getUTCMinutes())}${dos(fecha.getUTCSeconds())}Z`;

/** Texto de un campo ICS: escapa \, ; , y saltos de línea. */
export const escaparIcs = (t) => String(t ?? '').replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replace(/\r?\n/g, '\\n');

/** Una línea ICS de máximo 75 bytes por tramo (el resto continúa en la línea siguiente con un espacio), sin cortar letras con tilde. */
export function plegarLinea(linea) {
  const codificador = new TextEncoder();
  const partes = [];
  let actual = '';
  let bytes = 0;
  let limite = 75;
  for (const letra of linea) {
    const n = codificador.encode(letra).length;
    if (bytes + n > limite) {
      partes.push(actual);
      actual = '';
      bytes = 0;
      limite = 74; // la continuación lleva un espacio al inicio
    }
    actual += letra;
    bytes += n;
  }
  partes.push(actual);
  return partes.join('\r\n ');
}

/**
 * Lo que tiene plazo y sigue pendiente, en proyectos activos: objetivos (de resultado o de tiempo, sin lograr) y tareas.
 * Solo desde hoy en adelante (lo vencido ya no se agenda). Ordenado por fecha.
 */
export function plazosParaCalendario(datos, hoy) {
  const activos = new Set(datos.proyectos.filter((p) => p.estado === 'activo').map((p) => p.id));
  const proyecto = new Map(datos.proyectos.map((p) => [p.id, p]));
  const objetivos = new Map(datos.objetivos.map((o) => [o.id, o]));
  const lista = [];
  for (const o of datos.objetivos) {
    if (!o.plazo || o.plazo < hoy || o.logrado || o.archivado || !activos.has(o.proyectoId)) continue;
    lista.push({ uid: `objetivo-${o.id}@rumbo`, fecha: o.plazo, titulo: `Plazo: ${o.nombre}`, detalle: `${proyecto.get(o.proyectoId).nombre}${o.criterio ? ` · Meta: ${o.criterio}` : ''}` });
  }
  for (const t of datos.tareas) {
    const o = objetivos.get(t.objetivoId);
    if (!t.plazo || t.plazo < hoy || t.hecha || !o || o.archivado || !activos.has(o.proyectoId)) continue;
    lista.push({ uid: `tarea-${t.id}@rumbo`, fecha: t.plazo, titulo: `Plazo: ${t.titulo}`, detalle: `${proyecto.get(o.proyectoId).nombre} · ${o.nombre}` });
  }
  return lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.titulo.localeCompare(b.titulo, 'es'));
}

/** Próximo día de la semana (0 domingo … 6 sábado) desde `hoy` incluido. */
function proximoDia(hoy, diaSemana) {
  let f = hoy;
  for (let i = 0; i < 7; i++) {
    const [a, m, d] = f.split('-').map(Number);
    if (new Date(Date.UTC(a, m - 1, d)).getUTCDay() === diaSemana) return f;
    f = sumarUnDia(f);
  }
  return hoy;
}

const horaValida = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

/**
 * Arma el archivo .ics.
 * - `plazos`: de `plazosParaCalendario`; cada uno es un evento de día completo con aviso el día antes (9:00) y ese día (9:00).
 * - `diario: { hora, texto }`: recordatorio todos los días a esa hora (hora de tu reloj).
 * - `semanal: { hora, texto }`: recordatorio de tu revisión semanal, los domingos.
 * Los eventos llevan un identificador estable: si importas el archivo de nuevo, tu calendario actualiza en vez de duplicar.
 */
export function generarIcs({ plazos = [], diario = null, semanal = null, hoy, ahora = new Date() }) {
  const sello = utc(ahora);
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rumbo//Recordatorios//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Rumbo'];
  const alarma = (disparo, texto) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escaparIcs(texto)}`, `TRIGGER:${disparo}`, 'END:VALARM'];
  for (const p of plazos) {
    l.push('BEGIN:VEVENT', `UID:${p.uid}`, `DTSTAMP:${sello}`, `DTSTART;VALUE=DATE:${sinGuiones(p.fecha)}`, `DTEND;VALUE=DATE:${sinGuiones(sumarUnDia(p.fecha))}`,
      `SUMMARY:${escaparIcs(p.titulo)}`, `DESCRIPTION:${escaparIcs(p.detalle)}`, 'TRANSP:TRANSPARENT',
      ...alarma('-PT15H', `Mañana: ${p.titulo}`), ...alarma('PT9H', p.titulo), 'END:VEVENT');
  }
  if (diario && horaValida(diario.hora)) {
    l.push('BEGIN:VEVENT', 'UID:diario@rumbo', `DTSTAMP:${sello}`, `DTSTART:${flotante(hoy, diario.hora)}`, `DTEND:${flotante(hoy, sumarMinutos(diario.hora, 15))}`,
      'RRULE:FREQ=DAILY', `SUMMARY:${escaparIcs(diario.texto)}`, 'TRANSP:TRANSPARENT', ...alarma('PT0S', diario.texto), 'END:VEVENT');
  }
  if (semanal && horaValida(semanal.hora)) {
    const dia = proximoDia(hoy, 0);
    l.push('BEGIN:VEVENT', 'UID:semanal@rumbo', `DTSTAMP:${sello}`, `DTSTART:${flotante(dia, semanal.hora)}`, `DTEND:${flotante(dia, sumarMinutos(semanal.hora, 20))}`,
      'RRULE:FREQ=WEEKLY;BYDAY=SU', `SUMMARY:${escaparIcs(semanal.texto)}`, 'TRANSP:TRANSPARENT', ...alarma('PT0S', semanal.texto), 'END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return `${l.map(plegarLinea).join('\r\n')}\r\n`;
}
