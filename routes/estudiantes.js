const express = require('express');
const multer = require('multer');
const router = express.Router();
const { verificarProfesor } = require('../middleware/auth');
const estudianteController = require('../controllers/estudianteController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const subirExcel = (req, res, next) => {
  upload.single('archivo')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa demasiado (máx. 5 MB)' : 'No se pudo leer el archivo',
      });
    }
    next();
  });
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

router.get('/', estudianteController.getEstudiantes);
router.get('/grados-secciones', estudianteController.getGradosSecciones);
router.get('/:cedula', estudianteController.getEstudianteByCedula);
router.post('/', estudianteController.createEstudiante);
router.post('/bulk-upload', subirExcel, estudianteController.bulkUploadEstudiantes);
router.put('/:cedula', estudianteController.updateEstudiante);
router.delete('/:cedula', estudianteController.deleteEstudiante);

module.exports = router;
