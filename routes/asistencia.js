const express = require('express');
const router = express.Router();
const asistenciaController = require('../controllers/asistenciaController');

router.post('/', asistenciaController.registrarAsistencia);
router.get('/hoy', asistenciaController.getAsistenciaHoy);
router.get('/fecha/:fecha', asistenciaController.getAsistenciaByFecha);
router.get('/reporte/grado', asistenciaController.getAsistenciaPorGrado);
router.delete('/hoy', asistenciaController.limpiarAsistenciaHoy);
router.get('/reportes', asistenciaController.getReporteAsistencia);
router.get('/exportar-excel', asistenciaController.exportarReporteExcel);    // <-- Nueva ruta
router.get('/reportes-generados', asistenciaController.getReportesGenerados); // <-- Opcional
router.get('/reporte-completo-excel', asistenciaController.exportarReporteCompletoExcel);

module.exports = router;