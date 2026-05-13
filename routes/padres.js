const express = require('express');
const router = express.Router();
const { verificarToken, verificarPadre } = require('../middleware/auth');
const {
  getHijos,
  getAsistenciaEstudiante,
  getEstadisticasEstudiante,
  getHorariosEstudiante,
  getAlertasEstudiante,
  marcarAlertaLeida,
  generarReporteEstudiante
} = require('../controllers/padreController');
const {
  actualizarPushToken,
  getMisNotificaciones,
  marcarNotificacionLeida
} = require('../services/notificacionService');

// Todas las rutas requieren token + rol padre
router.use(verificarToken);
router.use(verificarPadre);

// Panel
router.get('/hijos',                        getHijos);
router.get('/asistencia/:estudianteId',     getAsistenciaEstudiante);
router.get('/estadisticas/:estudianteId',   getEstadisticasEstudiante);
router.get('/horarios/:estudianteId',       getHorariosEstudiante);
router.get('/alertas/:estudianteId',        getAlertasEstudiante);
router.put('/alertas/:alertaId/leer',       marcarAlertaLeida);
router.get('/reporte/:estudianteId',        generarReporteEstudiante);

// Notificaciones push
router.post('/push-token',                  actualizarPushToken);
router.get('/notificaciones',               getMisNotificaciones);
router.put('/notificaciones/:id/leer',      marcarNotificacionLeida);

module.exports = router;
