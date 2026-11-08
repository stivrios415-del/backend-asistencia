const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { verificarProfesor } = require('../middleware/auth');
const asistenciaController  = require('../controllers/asistenciaController');

// Multer para subir evidencias en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 }
});

router.use(verificarProfesor);

// --- Asistencia básica ---
router.post('/',                          asistenciaController.registrarAsistencia);
router.post('/finalizar-clase',           asistenciaController.finalizarClase);
router.post('/sync-batch',                asistenciaController.sincronizarAsistenciaBatch);

// --- Evidencias ---
router.post('/evidencia', (req, res, next) => {
  upload.single('foto')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'La foto pesa demasiado (máx. 4 MB)' : 'No se pudo leer la foto',
      });
    }
    next();
  });
}, asistenciaController.subirEvidencia);
router.get('/evidencia/:materiaId',       asistenciaController.listarEvidencias);
router.get('/evidencias',                 asistenciaController.listarEvidenciasRango); // panel de colegios rurales

// --- Panel de inicio ---
router.get('/panel',                      asistenciaController.getPanelProfesor);

// --- Consulta y reportes ---
router.get('/hoy',                        asistenciaController.getAsistenciaHoy);
router.delete('/hoy',                     asistenciaController.limpiarAsistenciaHoy);
router.delete('/:id',                     asistenciaController.eliminarAsistencia); // debe ir después de /hoy

router.get('/fecha/:fecha',               asistenciaController.getAsistenciaByFecha);
router.get('/reporte/grado',              asistenciaController.getAsistenciaPorGrado);
router.get('/reportes',                   asistenciaController.getReporteAsistencia);
router.get('/exportar-excel',             asistenciaController.exportarReporteExcel);
router.get('/reportes-generados',         asistenciaController.getReportesGenerados);
router.get('/reporte-completo-excel',     asistenciaController.exportarReporteCompletoExcel);
router.get('/estadisticas',               asistenciaController.getEstadisticas);
router.get('/roster/:materiaId',          asistenciaController.getRosterPorMateria);
router.get('/estadisticas/excel',         asistenciaController.exportarEstadisticasExcel);

module.exports = router;
