const express = require('express');
const router = express.Router();
const { verificarProfesorIndependiente } = require('../middleware/verificarProfesorIndependiente');
const ctrl = require('../controllers/profesorIndependienteController');

// ✅ Registro — público, sin token
router.post('/registro', ctrl.registrarProfesorIndependiente);

// 🔒 Todo lo demás requiere token de profesor independiente
router.use(verificarProfesorIndependiente);

// Clases
router.get('/clases', ctrl.getMisClases);
router.post('/clases', ctrl.crearClase);
router.delete('/clases/:id', ctrl.eliminarClase);

// Estudiantes
router.get('/clases/:claseId/estudiantes', ctrl.getEstudiantesDeClase);
router.post('/estudiantes', ctrl.crearEstudiante);
router.delete('/estudiantes/:cedula', ctrl.eliminarEstudiante);

// Asistencia
router.post('/asistencia', ctrl.registrarAsistencia);
router.get('/clases/:claseId/asistencia/hoy', ctrl.getAsistenciaHoy);
router.delete('/clases/:claseId/asistencia/hoy', ctrl.limpiarAsistenciaHoy);

// Reportes
router.get('/clases/:claseId/reporte', ctrl.getReporte);

module.exports = router;