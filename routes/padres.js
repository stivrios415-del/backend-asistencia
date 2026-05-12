const express = require('express');
const router = express.Router();
const { verificarPadre } = require('../middleware/auth');
const {
  getHijos,
  getAsistenciaEstudiante,
  getEstadisticasEstudiante,
  getHorariosEstudiante,
  getAlertasEstudiante,
  marcarAlertaLeida,
  generarReporteEstudiante
} = require('../controllers/padreController');

// Todas las rutas requieren autenticación de padre
router.use(verificarPadre);

// Obtener hijos del padre
router.get('/hijos', getHijos);

// Asistencia de un estudiante específico
router.get('/asistencia/:estudianteId', getAsistenciaEstudiante);

// Estadísticas de un estudiante
router.get('/estadisticas/:estudianteId', getEstadisticasEstudiante);

// Horarios de un estudiante
router.get('/horarios/:estudianteId', getHorariosEstudiante);

// Alertas de un estudiante
router.get('/alertas/:estudianteId', getAlertasEstudiante);

// Marcar alerta como leída
router.put('/alertas/:alertaId/leer', marcarAlertaLeida);

// Generar reporte de un estudiante
router.get('/reporte/:estudianteId', generarReporteEstudiante);

module.exports = router;