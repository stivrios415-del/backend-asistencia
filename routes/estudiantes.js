const express = require('express');
const multer = require('multer');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { verificarProfesor } = require('../middleware/auth');
const estudianteController = require('../controllers/estudianteController');

// Límite de tamaño: sin esto, un archivo enorme se carga entero en la memoria del servidor
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// ═══════════════════════════════════════════════════════════════
// Alumnos archivados (egresados o retirados) del colegio activo
// ═══════════════════════════════════════════════════════════════
async function cedulasArchivadas(institucion_id) {
  const set = new Set();
  for (let desde = 0; ; desde += 1000) {
    let q = supabase.from('estudiantes').select('cedula')
      .eq('archivado', true).order('cedula').range(desde, desde + 999);
    if (institucion_id) q = q.eq('institucion_id', institucion_id);
    const { data, error } = await q;
    if (error) throw error;
    data.forEach((e) => set.add(e.cedula));
    if (data.length < 1000) break;
  }
  return set;
}

// Quita a los archivados de la respuesta del listado, sin depender de qué columnas devuelva el controlador
const ocultarArchivados = async (req, res, next) => {
  try {
    const archivadas = await cedulasArchivadas(req.user?.institucion_id);
    if (archivadas.size) {
      const json = res.json.bind(res);
      res.json = (data) => json(Array.isArray(data) ? data.filter((e) => !archivadas.has(e?.cedula)) : data);
    }
  } catch (e) {
    // Si aún no existe la columna 'archivado', el listado sigue funcionando como antes
    console.warn('⚠️ No se pudo ocultar a los archivados:', e.message);
  }
  next();
};

// ═══════════════════════════════════════════════════════════════
// ✅ RUTAS PÚBLICAS — sin token (para la credencial del estudiante)
// ═══════════════════════════════════════════════════════════════
router.get('/publico/:cedula', estudianteController.getEstudiantePublico);

// ═══════════════════════════════════════════════════════════════
// 🔒 RUTAS PROTEGIDAS — requieren token de profesor/admin
//    (el coordinador de red entra aquí como admin del colegio elegido)
// ═══════════════════════════════════════════════════════════════
router.use(verificarProfesor);

router.get('/', ocultarArchivados, estudianteController.getEstudiantes);
router.get('/grados-secciones', estudianteController.getGradosSecciones);
router.get('/:cedula', estudianteController.getEstudianteByCedula);
router.post('/', estudianteController.createEstudiante);
router.post('/bulk-upload', upload.single('archivo'), estudianteController.bulkUploadEstudiantes);
router.put('/:cedula', estudianteController.updateEstudiante);
router.delete('/:cedula', estudianteController.deleteEstudiante);

module.exports = router;
