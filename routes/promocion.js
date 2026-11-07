const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { verificarToken, verificarAdmin } = require('../middleware/auth');

router.use(verificarToken, verificarAdmin);

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

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

const lotes = (arr, n = 150) => {
  const r = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r;
};

// Aplica estados [{ cedula, grado, carrera, archivado, anio, motivo }] agrupando a los que
// quedan igual, para hacer pocas consultas en vez de una por alumno.
async function aplicarEstados(institucion_id, estados) {
  const grupos = new Map();
  for (const e of estados) {
    const k = JSON.stringify([e.grado, e.carrera, !!e.archivado, e.anio ?? null, e.motivo ?? null]);
    if (!grupos.has(k)) grupos.set(k, { e, cedulas: [] });
    grupos.get(k).cedulas.push(e.cedula);
  }
  for (const { e, cedulas } of grupos.values()) {
    const cambios = {
      grado: String(e.grado),
      carrera: e.carrera ?? null,
      archivado: !!e.archivado,
      archivado_en: e.archivado ? new Date().toISOString() : null,
      anio_egreso: e.archivado ? (e.anio ?? null) : null,
      motivo_archivo: e.archivado ? (e.motivo ?? null) : null,
    };
    for (const lote of lotes(cedulas)) {
      const { error } = await supabase.from('estudiantes').update(cambios)
        .eq('institucion_id', institucion_id).in('cedula', lote);
      if (error) throw error;
    }
  }
}

// ── Alumnos activos + último cierre ──
router.get('/vista', async (req, res) => {
  try {
    const inst = req.user.institucion_id;
    const [{ data: cfg }, estudiantes, { data: ultima }] = await Promise.all([
      supabase.from('instituciones').select('grado_final').eq('id', inst).single(),
      traerTodo(() => supabase.from('estudiantes')
        .select('cedula, nombre, apellido, grado, seccion, carrera')
        .eq('institucion_id', inst).eq('archivado', false).order('cedula')),
      supabase.from('promociones')
        .select('id, anio, realizada_en, promovidos, egresados')
        .eq('institucion_id', inst).eq('deshecha', false)
        .order('realizada_en', { ascending: false }).limit(1),
    ]);
    res.json({ gradoFinal: cfg?.grado_final ?? 12, estudiantes, ultimaPromocion: ultima?.[0] || null });
  } catch (e) {
    console.error('❌ promocion/vista:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Cierre de año ──
router.post('/aplicar', async (req, res) => {
  try {
    const inst = req.user.institucion_id;
    const grados = new Set((req.body.grados || []).map((g) => String(g).trim()));
    const excepciones = new Set((req.body.excepciones || []).map(String));
    const carreras = req.body.carreras || {};
    const anio = parseInt(req.body.anio, 10);

    if (!grados.size) return res.status(400).json({ error: 'Elige al menos un grado que pasa de año' });
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return res.status(400).json({ error: 'Año escolar inválido' });

    const { data: cfg } = await supabase.from('instituciones').select('grado_final').eq('id', inst).single();
    const gradoFinal = cfg?.grado_final ?? 12;

    const activos = await traerTodo(() => supabase.from('estudiantes')
      .select('cedula, grado, carrera').eq('institucion_id', inst).eq('archivado', false).order('cedula'));

    const detalle = [];
    const faltanCarrera = [];
    let promovidos = 0, egresados = 0, repiten = 0, omitidos = 0;

    for (const e of activos) {
      if (!grados.has(String(e.grado).trim())) continue;
      if (excepciones.has(e.cedula)) { repiten++; continue; }
      const g = parseInt(e.grado, 10);
      if (!Number.isInteger(g)) { omitidos++; continue; }

      const de = { grado: String(e.grado), carrera: e.carrera ?? null, archivado: false };
      if (g >= gradoFinal) {
        detalle.push({ cedula: e.cedula, de, a: { grado: String(e.grado), carrera: e.carrera ?? null, archivado: true, anio, motivo: 'egresado' } });
        egresados++;
      } else {
        let carrera = e.carrera ?? null;
        // Ciclo común (7° a 9°) → 10°: hay que elegir carrera, si no el alumno no encuentra clase
        if (norm(carrera) === 'ciclo' && g + 1 >= 10) {
          const elegida = String(carreras[e.cedula] || '').trim();
          if (!elegida || norm(elegida) === 'ciclo') { faltanCarrera.push(e.cedula); continue; }
          carrera = elegida;
        }
        detalle.push({ cedula: e.cedula, de, a: { grado: String(g + 1), carrera, archivado: false } });
        promovidos++;
      }
    }

    if (faltanCarrera.length) {
      return res.status(400).json({ error: `Falta elegir la carrera de ${faltanCarrera.length} alumno(s) que pasan a 10°`, faltanCarrera });
    }
    if (!detalle.length) return res.status(400).json({ error: 'No hay alumnos para pasar con esa selección' });

    // Se guarda primero el registro (permite deshacer) y se aplica; si algo falla, se revierte
    const { data: log, error: errLog } = await supabase.from('promociones')
      .insert([{ institucion_id: inst, anio, realizada_por: req.user.id, promovidos, egresados, detalle }])
      .select('id').single();
    if (errLog) throw errLog;

    try {
      await aplicarEstados(inst, detalle.map((d) => ({ cedula: d.cedula, ...d.a })));
    } catch (err) {
      try { await aplicarEstados(inst, detalle.map((d) => ({ cedula: d.cedula, ...d.de }))); }
      catch (e2) { console.error('❌ rollback del cierre de año:', e2.message); }
      await supabase.from('promociones').delete().eq('id', log.id);
      throw err;
    }

    req.app.locals.cache?.del('panel:');
    console.log(`📚 Cierre de año ${anio} (${inst}): ${promovidos} pasan, ${egresados} egresan, ${repiten} repiten — por ${req.user.email}`);
    res.json({ success: true, promovidos, egresados, repiten, omitidos });
  } catch (e) {
    console.error('❌ promocion/aplicar:', e.message);
    res.status(500).json({ error: 'No se pudo aplicar el cierre de año: ' + e.message });
  }
});

// ── Deshacer el último cierre ──
router.post('/deshacer', async (req, res) => {
  try {
    const inst = req.user.institucion_id;
    const { data: ult } = await supabase.from('promociones')
      .select('id, detalle').eq('institucion_id', inst).eq('deshecha', false)
      .order('realizada_en', { ascending: false }).limit(1);
    const p = ult?.[0];
    if (!p) return res.status(404).json({ error: 'No hay un cierre de año para deshacer' });

    await aplicarEstados(inst, p.detalle.map((d) => ({ cedula: d.cedula, ...d.de })));
    await supabase.from('promociones').update({ deshecha: true }).eq('id', p.id);
    req.app.locals.cache?.del('panel:');
    res.json({ success: true });
  } catch (e) {
    console.error('❌ promocion/deshacer:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Archivo (papelera) ──
router.get('/archivo', async (req, res) => {
  try {
    const lista = await traerTodo(() => supabase.from('estudiantes')
      .select('cedula, nombre, apellido, grado, carrera, anio_egreso, archivado_en, motivo_archivo')
      .eq('institucion_id', req.user.institucion_id).eq('archivado', true).order('cedula'));
    lista.sort((a, b) => (b.anio_egreso || 0) - (a.anio_egreso || 0) || (a.apellido || '').localeCompare(b.apellido || ''));
    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/restaurar', async (req, res) => {
  try {
    const cedulas = Array.isArray(req.body.cedulas) ? req.body.cedulas.map(String).slice(0, 500) : [];
    if (!cedulas.length) return res.status(400).json({ error: 'Falta elegir alumnos' });
    for (const lote of lotes(cedulas)) {
      const { error } = await supabase.from('estudiantes')
        .update({ archivado: false, archivado_en: null, anio_egreso: null, motivo_archivo: null })
        .eq('institucion_id', req.user.institucion_id).eq('archivado', true).in('cedula', lote);
      if (error) throw error;
    }
    req.app.locals.cache?.del('panel:');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Archivar a mano (alumno que se retiró a mitad de año)
router.post('/archivar', async (req, res) => {
  try {
    const cedulas = Array.isArray(req.body.cedulas) ? req.body.cedulas.map(String).slice(0, 200) : [];
    const motivo = req.body.motivo === 'egresado' ? 'egresado' : 'retirado';
    if (!cedulas.length) return res.status(400).json({ error: 'Falta elegir alumnos' });
    for (const lote of lotes(cedulas)) {
      const { error } = await supabase.from('estudiantes')
        .update({
          archivado: true, archivado_en: new Date().toISOString(),
          anio_egreso: motivo === 'egresado' ? new Date().getFullYear() : null, motivo_archivo: motivo,
        })
        .eq('institucion_id', req.user.institucion_id).eq('archivado', false).in('cedula', lote);
      if (error) throw error;
    }
    req.app.locals.cache?.del('panel:');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;