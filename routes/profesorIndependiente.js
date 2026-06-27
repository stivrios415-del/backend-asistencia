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

// ✅ Materias (dentro de una clase)
router.get('/clases/:claseId/materias', ctrl.getMateriasDeClase);
router.post('/materias', ctrl.crearMateria);
router.delete('/materias/:id', ctrl.eliminarMateria);

// Estudiantes
router.get('/clases/:claseId/estudiantes', ctrl.getEstudiantesDeClase);
router.post('/estudiantes', ctrl.crearEstudiante);
router.delete('/estudiantes/:cedula', ctrl.eliminarEstudiante);

// Asistencia (✅ ahora por materia)
router.post('/asistencia', ctrl.registrarAsistencia);
router.get('/materias/:materiaId/asistencia/hoy', ctrl.getAsistenciaHoy);
router.delete('/materias/:materiaId/asistencia/hoy', ctrl.limpiarAsistenciaHoy);

// Reportes
router.get('/materias/:materiaId/reporte', ctrl.getReporte);
router.get('/clases/:claseId/reporte-completo', ctrl.getReporteClaseCompleto);

module.exports = router;
