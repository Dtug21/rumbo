// ejemplo.js — proyecto de muestra para ver cómo funciona Rumbo antes de cargar lo propio. Se borra como cualquier proyecto.
import { PASOS_BASE, inicioSemana, nuevoObjetivo, nuevaTarea } from './logic.js';

export function proyectoEjemplo(hoy, crearId) {
  const proyectoId = crearId();
  const lanzar = crearId();
  const estudiar = crearId();
  const textos = crearId();
  const paso = (texto, hecho = false) => ({ id: crearId(), texto, hecho });
  const tarea = (x) => nuevaTarea({ id: crearId(), objetivoId: lanzar, creado: hoy, ...x });
  return {
    proyecto: {
      id: proyectoId, nombre: 'Ejemplo: mi primer proyecto', tipo: 'principal', estado: 'activo', creado: hoy,
      descripcion: 'Proyecto de muestra. Juega con él y bórralo cuando cargues los tuyos.',
    },
    objetivos: [
      nuevoObjetivo({ id: lanzar, proyectoId, nombre: 'Publicar una página simple', criterio: 'La página está en línea y 5 personas la vieron', creado: hoy }),
      nuevoObjetivo({ id: estudiar, proyectoId, nombre: 'Estudiar diseño web', tipo: 'tiempo', minutosMeta: 120, periodo: 'semana', creado: hoy }),
    ],
    tareas: [
      tarea({ titulo: 'Elegir el nombre', tamano: 'simple', minutos: 15, hecha: true, hechaEl: hoy, tocado: hoy }),
      tarea({ id: textos, titulo: 'Escribir los textos', tamano: 'media', minutos: 60, pasos: [paso('Título y frase principal', true), paso('Qué ofrezco', true), paso('Preguntas frecuentes'), paso('Revisar ortografía')], tocado: hoy }),
      tarea({ titulo: 'Armar la página', tamano: 'amplia', minutos: 240, pasos: PASOS_BASE.map((t) => paso(t)) }),
    ],
    registros: [{ id: crearId(), fecha: inicioSemana(hoy), minutos: 30, objetivoId: estudiar, tareaId: null }],
    notas: [
      { id: crearId(), fecha: hoy, texto: 'Pedirle a alguien que revise el texto principal antes de publicar.', objetivoId: lanzar, tareaId: textos, falta: true },
    ],
  };
}
