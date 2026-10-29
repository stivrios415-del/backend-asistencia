const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { verificarToken, verificarCoordinador } = require('../middleware/auth');

// Público: ¿este código es de una red de colegios?
router.get('/codigo/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo || '').trim().toUpperCase().slice(0, 20);
  const { data } = await supabase.from('redes').select('id, nombre, activo').eq('codigo', codigo).maybeSingle();
  if (!data || data.activo === false) return res.status(404).json({ error: 'Código no encontrado' });
  res.json({ tipo: 'red', id: data.id, nombre: data.nombre });
});

// Coordinador: su red y un cuadro por colegio
router.get('/mi-red', verificarToken, verificarCoordinador, async (req, res) => {
  try {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Tegucigalpa' });
    const [{ data: red }, { data: coord }, { data: colegios, error }] = await Promise.all([
      supabase.from('redes').select('id, nombre').eq('id', req.user.red_id).single(),
      supabase.from('red_coordinadores').select('nombre').eq('usuario_id', req.user.id).single(),
      supabase.from('instituciones')
        .select('id, nombre, color_primario, color_secundario, logo_url, es_rural, requiere_evidencia')
        .eq('red_id', req.user.red_id).order('nombre'),
    ]);
    if (error) throw error;

    const conDatos = await Promise.all((colegios || []).map(async (c) => {
      const cuenta = (tabla, campo, filtros) => {
        let q = supabase.from(tabla).select(campo, { count: 'exact', head: true }).eq('institucion_id', c.id);
        for (const [k, v] of filtros) q = q.eq(k, v);
        return q;
      };
      const [est, prof, pres, evid] = await Promise.all([
        cuenta('estudiantes', 'cedula', []),
        cuenta('profesores', 'id', [['rol', 'profesor']]),
        cuenta('asistencia', 'cedula', [['fecha', hoy]]).neq('estado', 'excusado'),
        cuenta('evidencias_clase', 'id', [['fecha', hoy]]),
      ]);
      return {
        ...c,
        estudiantes: est.count || 0, profesores: prof.count || 0,
        presentesHoy: pres.count || 0, evidenciaHoy: evid.count || 0,
      };
    }));

    res.json({ red, nombre: coord?.nombre || null, colegios: conDatos });
  } catch (e) {
    console.error('❌ mi-red:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;