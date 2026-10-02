// plantillas.js — ideas de proyectos listas para usar: objetivos concretos con sus tareas y pasos.
// Son puntos de partida (práctica común de planificación), no recetas: se ajustan después.
import { nuevoObjetivo, nuevaTarea } from './logic.js';

const t = (titulo, tamano, minutos, pasos = []) => ({ titulo, tamano, minutos, pasos });

export const PLANTILLAS = Object.freeze([
  {
    id: 'app',
    etiquetaPlazo: 'Fecha en que quieres tenerla lista',
    nombre: 'Lanzar una app o producto digital',
    descripcion: 'De la idea a las primeras personas usándolo, sin construir de más.',
    ejemplo: 'Mi app',
    objetivos: [
      {
        nombre: 'Primera versión en manos de 5 usuarios', criterio: '5 personas la usaron y me dieron su opinión',
        tareas: [
          t('Escribir en una frase el problema que resuelve', 'simple', 20),
          t('Definir las 3 funciones mínimas', 'media', 60, ['Listar todo lo que podría tener', 'Elegir solo 3', 'Dejar el resto para después']),
          t('Armar un prototipo navegable', 'amplia', 240, ['Bocetos en papel', 'Pantallas principales', 'Conectar el recorrido', 'Probarlo en el celular']),
          t('Probar con 5 personas y anotar lo que dicen', 'amplia', 180, ['Elegir a las 5 personas', 'Preparar 3 preguntas', 'Hacer las pruebas', 'Resumir lo aprendido']),
        ],
      },
      { nombre: 'Avanzar en el desarrollo', tipo: 'tiempo', horas: 4 },
    ],
  },
  {
    id: 'examen',
    etiquetaPlazo: 'Fecha del examen o concurso',
    nombre: 'Preparar un examen o concurso',
    descripcion: 'Estudio constante más ensayos. Practicar recordando (ensayos, preguntas) rinde más que releer (Dunlosky et al., 2013).',
    ejemplo: 'Concurso cargo diurno',
    objetivos: [
      { nombre: 'Estudiar cada semana', tipo: 'tiempo', horas: 5 },
      {
        nombre: 'Temario completo repasado', criterio: 'Respondo bien el 80% de un ensayo',
        tareas: [
          t('Reunir el temario oficial y el material', 'simple', 30),
          t('Dividir el temario en unidades y fechas', 'media', 45, ['Listar las unidades', 'Asignar semanas', 'Dejar la última semana para repasar']),
          t('Hacer un ensayo completo', 'amplia', 150, ['Conseguir un ensayo', 'Rendirlo con tiempo', 'Corregirlo', 'Anotar los temas débiles']),
          t('Repasar los temas débiles', 'amplia', 180, ['Elegir los 3 más débiles', 'Hacer preguntas de cada uno', 'Responderlas sin mirar', 'Revisar lo que falló']),
        ],
      },
    ],
  },
  {
    id: 'postular',
    etiquetaPlazo: 'Fecha límite para postular',
    nombre: 'Postular a un trabajo o cargo',
    descripcion: 'Postulación completa a tiempo y entrevista preparada.',
    ejemplo: 'Postulación cargo diurno',
    objetivos: [
      {
        nombre: 'Postulación enviada', criterio: 'Envié todo lo que piden antes del plazo', indicadores: ['Respuestas', 'Entrevistas', 'Ofertas'],
        tareas: [
          t('Leer bien las bases y los requisitos', 'simple', 30),
          t('Actualizar el currículum', 'media', 90, ['Experiencia reciente', 'Formación y cursos', 'Revisar ortografía']),
          t('Reunir certificados y documentos', 'media', 60, ['Hacer la lista de lo que piden', 'Pedir lo que falta', 'Escanear todo']),
          t('Escribir la carta de presentación', 'media', 60, ['Por qué yo', 'Por qué este cargo', 'Pedirle a alguien que la revise']),
          t('Enviar la postulación', 'simple', 20),
        ],
      },
      {
        nombre: 'Entrevista preparada', criterio: 'Respondo en voz alta las 10 preguntas más probables',
        tareas: [
          t('Listar las 10 preguntas más probables', 'simple', 30),
          t('Ensayar las respuestas en voz alta', 'media', 60, ['Escribir ideas clave', 'Ensayar solo', 'Ensayar con alguien']),
        ],
      },
    ],
  },
  {
    id: 'emprender',
    etiquetaPlazo: 'Fecha en que quieres abrir',
    nombre: 'Validar un emprendimiento',
    descripcion: 'Confirmar que alguien pagaría antes de invertir tiempo y plata en construirlo.',
    ejemplo: 'Mi emprendimiento',
    objetivos: [
      {
        nombre: 'Confirmar que alguien pagaría', criterio: '10 conversaciones con posibles clientes y al menos 3 interesados reales', indicadores: ['Interesados', 'Ventas'],
        tareas: [
          t('Escribir a quién le resuelves qué problema', 'simple', 30),
          t('Conversar con 10 posibles clientes', 'amplia', 300, ['Hacer la lista de 10', 'Preparar preguntas sin vender', 'Tener las conversaciones', 'Resumir lo que se repite']),
          t('Definir precio y propuesta', 'media', 60, ['Ver alternativas y precios', 'Elegir un precio de prueba', 'Escribir la propuesta en 3 líneas']),
          t('Conseguir la primera venta o reserva', 'amplia', 180, ['Ofrecerlo a los interesados', 'Hacer seguimiento', 'Cerrar la primera venta']),
        ],
      },
    ],
  },
  {
    id: 'aprender',
    etiquetaPlazo: 'Fecha en que quieres lograrlo',
    nombre: 'Aprender una habilidad nueva',
    descripcion: 'Práctica semanal más un proyecto real que demuestre lo aprendido.',
    ejemplo: 'Aprender diseño web',
    objetivos: [
      { nombre: 'Practicar cada semana', tipo: 'tiempo', horas: 3 },
      {
        nombre: 'Terminar un proyecto práctico', criterio: 'Tengo algo terminado que puedo mostrar',
        tareas: [
          t('Elegir un curso o recurso principal', 'simple', 30),
          t('Definir el proyecto práctico', 'simple', 30),
          t('Hacer el proyecto práctico', 'amplia', 360, ['Primera versión', 'Pedir opinión', 'Mejorarlo', 'Mostrarlo']),
        ],
      },
    ],
  },
  {
    id: 'creativo',
    etiquetaPlazo: 'Fecha en que quieres terminarlo',
    nombre: 'Terminar un proyecto creativo',
    descripcion: 'Música, escritura o diseño: tiempo fijo para crear y una definición clara de "terminado".',
    ejemplo: 'Mi canción',
    objetivos: [
      { nombre: 'Crear cada semana', tipo: 'tiempo', horas: 2 },
      {
        nombre: 'Obra terminada y compartida', criterio: 'La publiqué o se la mostré a 3 personas', indicadores: ['Personas que la vieron o escucharon'],
        tareas: [
          t('Definir qué significa "terminado"', 'simple', 20),
          t('Primer borrador completo', 'amplia', 240, ['Estructura', 'Primera mitad', 'Segunda mitad', 'Unirlo todo']),
          t('Revisar y pulir', 'amplia', 180, ['Escucharlo o leerlo completo', 'Anotar qué mejorar', 'Corregir']),
          t('Compartirlo', 'simple', 30),
        ],
      },
    ],
  },
]);

/** Crea los objetivos y tareas de una plantilla para un proyecto. */
export function aplicarPlantilla(plantilla, proyectoId, hoy, crearId, plazo = null) {
  const objetivos = [];
  const tareas = [];
  let plazoPuesto = false;
  for (const o of plantilla.objetivos) {
    const id = crearId();
    const tiempo = o.tipo === 'tiempo';
    objetivos.push(nuevoObjetivo({
      id, proyectoId, nombre: o.nombre, criterio: o.criterio ?? '', creado: hoy,
      // La fecha que ponga la persona va al primer objetivo con resultado (el que tiene una meta que lograr).
      plazo: !tiempo && plazo && !plazoPuesto ? ((plazoPuesto = true), plazo) : null,
      tipo: tiempo ? 'tiempo' : 'resultado', minutosMeta: tiempo ? Math.round(o.horas * 60) : null, periodo: tiempo ? 'semana' : null,
      indicadores: (o.indicadores ?? []).map((nombre) => ({ id: crearId(), nombre, eventos: [] })),
    }));
    for (const x of o.tareas ?? []) {
      tareas.push(nuevaTarea({
        id: crearId(), objetivoId: id, titulo: x.titulo, tamano: x.tamano, minutos: x.minutos, creado: hoy,
        pasos: x.pasos.map((texto) => ({ id: crearId(), texto, hecho: false })),
      }));
    }
  }
  return { objetivos, tareas };
}
