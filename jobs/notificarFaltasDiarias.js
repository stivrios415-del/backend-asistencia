const cron = require('node-cron');
const { supabase } = require('../config/supabase');
const { notificarFalta } = require('../services/notificacionService');

const ZONA_HORARIA = 'America/Tegucigalpa';

// Fecha de HOY en Honduras. No usar toISOString(): da la fecha UTC y, de noche, ya es "mañana".
const fechaHondurasHoy = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });

// Supabase devuelve máximo 1000 filas por consulta: se pagina para no perder registros
async function traerTodo(construir) {
  const PAGINA = 1000;
  const todo = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await construir().range(desde, desde + PAGINA - 1);
    if (error) throw error;
    todo.push(...data);
    if (data.length < PAGINA) break;
  }
  return todo;
}

let corriendo = false; // evita dos ejecuciones al mismo tiempo

const ejecutarNotificacionFaltas = async () => {
  if (corriendo) {
    console.warn('⚠️ El job de faltas ya está corriendo, se omite esta ejecución.');
    return;
  }
  corriendo = true;
  const hoy = fechaHondurasHoy();
  console.log(`\n⏰ [${new Date().toISOString()}] Job faltas → ${hoy}`);

  try {
    const [asistencias, activos, vinculaciones] = await Promise.all([
      traerTodo(() => supabase.from('asistencia')
        .select('cedula, institucion_id, estado').eq('fecha', hoy).order('id')),
      // Solo alumnos activos: los archivados (egresados o retirados) nunca se notifican
      traerTodo(() => supabase.from('estudiantes')
        .select('cedula, institucion_id').eq('archivado', false).order('cedula')),
      traerTodo(() => supabase.from('padre_estudiante')
        .select('estudiante_cedula').order('estudiante_cedula')),
    ]);

    const colegioDe = new Map(activos.map((e) => [e.cedula, e.institucion_id]));

    // Presentes (incluye excusados) y colegios que SÍ pasaron lista hoy
    const presentes = new Set();
    const colegiosConLista = new Set();
    for (const a of asistencias) {
      presentes.add(a.cedula);
      if (a.estado !== 'excusado') {
        const colegio = a.institucion_id || colegioDe.get(a.cedula);
        if (colegio) colegiosConLista.add(colegio);
      }
    }

    const conPadre = [...new Set(vinculaciones.map((v) => v.estudiante_cedula))];
    const faltaron = conPadre.filter((cedula) => {
      const colegio = colegioDe.get(cedula);
      if (!colegio) return false;                         // archivado o inexistente
      if (!colegiosConLista.has(colegio)) return false;   // ese colegio no pasó lista hoy (feriado o sin sincronizar)
      return !presentes.has(cedula);
    });

    console.log(
      `📊 Con padre: ${conPadre.length} | Colegios con lista hoy: ${colegiosConLista.size} | ` +
      `Presentes: ${presentes.size} | Faltaron: ${faltaron.length}`
    );

    if (process.env.FALTAS_DRY_RUN === '1') {
      console.log('🧪 DRY RUN: no se envía ninguna notificación.');
      return;
    }

    let enviadas = 0;
    let fallidas = 0;
    for (const cedula of faltaron) {
      try {
        await notificarFalta(cedula, hoy, null);
        enviadas++;
      } catch (e) {
        fallidas++;
        console.error(`❌ notificarFalta ${cedula}:`, e.message);
      }
    }
    console.log(`✅ Job finalizado — enviadas: ${enviadas} | fallidas: ${fallidas}\n`);
  } catch (error) {
    console.error('❌ Error job faltas:', error.message);
  } finally {
    corriendo = false;
  }
};

const iniciarJobFaltas = () => {
  // 3:00 PM hora de Honduras, lunes a viernes (la hora del cron se lee en la zona indicada)
  cron.schedule('0 15 * * 1-5', ejecutarNotificacionFaltas, { timezone: ZONA_HORARIA });
  console.log('⏰ Job de faltas programado — 3:00 PM (hora de Honduras) L-V');
};

module.exports = { iniciarJobFaltas, ejecutarNotificacionFaltas };
