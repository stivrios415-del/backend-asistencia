const express = require('express');
const router  = express.Router();
const { verificarProfesor } = require('../middleware/auth');
const asistenciaController  = require('../controllers/asistenciaController');

router.use(verificarProfesor);

// ── POST ─────────────────────────────────────────────
router.post('/',                asistenciaController.registrarAsistencia);
router.post('/finalizar-clase', asistenciaController.finalizarClase);
router.post('/sync-batch',      asistenciaController.sincronizarAsistenciaBatch);

// ── GET específicas ──────────────────────────────────
router.get('/hoy',                     asistenciaController.getAsistenciaHoy);
router.get('/fecha/:fecha',            asistenciaController.getAsistenciaByFecha);
router.get('/reporte/grado',           asistenciaController.getAsistenciaPorGrado);
router.get('/reportes',                asistenciaController.getReporteAsistencia);
router.get('/exportar-excel',          asistenciaController.exportarReporteExcel);
router.get('/reportes-generados',      asistenciaController.getReportesGenerados);
router.get('/reporte-completo-excel',  asistenciaController.exportarReporteCompletoExcel);
router.get('/estadisticas',            asistenciaController.getEstadisticas);
router.get('/estadisticas/excel',      asistenciaController.exportarEstadisticasExcel);
router.get('/roster/:materiaId',       asistenciaController.getRosterPorMateria);

// ── DELETE específicas (ANTES de /:id) ───────────────
router.delete('/hoy', asistenciaController.limpiarAsistenciaHoy);

// ── DELETE con parámetro (SIEMPRE al final) ──────────
router.delete('/:id', asistenciaController.eliminarAsistencia);

module.exports = router;
