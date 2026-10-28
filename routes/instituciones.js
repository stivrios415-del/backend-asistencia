const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { verificarToken } = require('../middleware/auth');
const { verificarMasterAdmin } = require('../middleware/verificarMasterAdmin');
const {
  getInstitucionPorCodigo,
  listarInstituciones,
  crearInstitucion,
} = require('../controllers/institucionesController');

// Buscar institución por código (público — lo usa la app al iniciar)
router.get('/codigo/:codigo', getInstitucionPorCodigo);

// Branding de la institución del usuario autenticado (lo usa la web).
// Se lee desde el backend porque 'instituciones' tiene RLS sin políticas.
router.get('/mia', verificarToken, async (req, res) => {
  const institucionId = req.user?.institucion_id;
  if (!institucionId) return res.status(404).json({ error: 'Sin institución asociada' });
  
  const { data, error } = await supabase
    .from('instituciones')
    // 👇 AQUÍ ESTÁ TU LÍNEA PEGADA 👇
    .select('id, nombre, color_primario, color_secundario, logo_url, requiere_evidencia')
    .eq('id', institucionId)
    .single();
    
  if (error || !data) return res.status(404).json({ error: 'Institución no encontrada' });
  res.json(data);
});

// Solo dueño de la app (header x-master-admin-code)
router.get('/', verificarMasterAdmin, listarInstituciones);
router.post('/', verificarMasterAdmin, crearInstitucion);

module.exports = router;
