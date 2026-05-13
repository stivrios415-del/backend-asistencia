const cron = require('node-cron');
const { supabase } = require('../config/supabase');
const { notificarFalta } = require('../services/notificacionService');

const ejecutarNotificacionFaltas = async () => {
  const hoy = new Date().toISOString().split('T')[0];
  console.log(`\n⏰ [${new Date().toISOString()}] Job faltas → ${hoy}`);
  try {
    const { data: asistencias } = await supabase
      .from('asistencia').select('cedula').eq('fecha', hoy);
    const presentes = new Set((asistencias || []).map(a => a.cedula));

    const { data: vinculaciones } = await supabase
      .from('padre_estudiante').select('estudiante_cedula');
    if (!vinculaciones || vinculaciones.length === 0) return;

    const conPadre = [...new Set(vinculaciones.map(v => v.estudiante_cedula))];
    const faltaron = conPadre.filter(c => !presentes.has(c));

    console.log(`📊 Con padre: ${conPadre.length} | Presentes: ${presentes.size} | Faltaron: ${faltaron.length}`);
    for (const cedula of faltaron) {
      await notificarFalta(cedula, hoy, null);
    }
    console.log(`✅ Job finalizado\n`);
  } catch (error) {
    console.error('❌ Error job faltas:', error.message);
  }
};

const iniciarJobFaltas = () => {
  // 3 PM Honduras = 21:00 UTC, lunes a viernes
  cron.schedule('0 21 * * 1-5', ejecutarNotificacionFaltas, {
    timezone: 'America/Tegucigalpa'
  });
  console.log('⏰ Job de faltas programado — 3:00 PM L-V');
};

module.exports = { iniciarJobFaltas, ejecutarNotificacionFaltas };