const express = require('express');
const router  = express.Router();
const { verificarProfesor } = require('../middleware/auth');
const asistenciaController  = require('../controllers/asistenciaController');

router.use(verificarProfesor);

router.post('/',                          asistenciaController.registrarAsistencia);
router.post('/finalizar-clase',           asistenciaController.finalizarClase);
router.get('/hoy',                        asistenciaController.getAsistenciaHoy);
router.get('/fecha/:fecha',               asistenciaController.getAsistenciaByFecha);
router.get('/reporte/grado',              asistenciaController.getAsistenciaPorGrado);
router.delete('/hoy',                     asistenciaController.limpiarAsistenciaHoy);
router.get('/reportes',                   asistenciaController.getReporteAsistencia);
router.get('/exportar-excel',             asistenciaController.exportarReporteExcel);
router.get('/reportes-generados',         asistenciaController.getReportesGenerados);
router.get('/reporte-completo-excel',     asistenciaController.exportarReporteCompletoExcel);
router.get('/estadisticas',               asistenciaController.getEstadisticas);
router.get('/estadisticas/excel',         asistenciaController.exportarEstadisticasExcel);

module.exports = router;
