const express = require('express');
const multer = require('multer');
const router = express.Router();
const { verificarProfesorIndependiente } = require('../middleware/verificarProfesorIndependiente');
const ctrl = require('../controllers/profesorIndependienteController');

const upload = multer({ storage: multer.memoryStorage() });

// ✅ Registro — público, sin token
router.post('/registro', ctrl.registrarProfesorIndependiente);

// ✅ NUEVO: Verificación del código de acceso — público, sin token
router.post('/verificar-codigo', ctrl.verificarCodigoAcceso);

// 🔒 Todo lo demás requiere token de profesor independiente
router.use(verificarProfesorIndependiente);

// ✅ NUEVO: Vincular código a la cuenta — requiere estar logueado
router.post('/vincular-codigo', ctrl.vincularCodigoAcceso);
// 🔒 Todo lo demás requiere token de profesor independiente
router.use(verificarProfesorIndependiente);

// ✅ NUEVO: Estado de suscripción — requiere estar logueado
router.get('/mi-estado', ctrl.getMiEstado);

// ✅ NUEVO: Vincular código a la cuenta — requiere estar logueado
router.post('/vincular-codigo', ctrl.vincularCodigoAcceso);

// ...el resto igual

// Clases
router.get('/clases', ctrl.getMisClases);
router.post('/clases', ctrl.crearClase);
router.delete('/clases/:id', ctrl.eliminarClase);

// Materias
router.get('/clases/:claseId/materias', ctrl.getMateriasDeClase);
router.post('/materias', ctrl.crearMateria);
router.delete('/materias/:id', ctrl.eliminarMateria);

// Estudiantes
router.get('/clases/:claseId/estudiantes', ctrl.getEstudiantesDeClase);
router.post('/estudiantes', ctrl.crearEstudiante);
router.post('/estudiantes/bulk-upload', upload.single('archivo'), ctrl.bulkUploadEstudiantes);
router.delete('/estudiantes/:cedula', ctrl.eliminarEstudiante);

// Asistencia
router.post('/asistencia', ctrl.registrarAsistencia);
router.get('/materias/:materiaId/asistencia/hoy', ctrl.getAsistenciaHoy);
router.delete('/materias/:materiaId/asistencia/hoy', ctrl.limpiarAsistenciaHoy);

// Reportes
router.get('/materias/:materiaId/reporte', ctrl.getReporte);
router.get('/clases/:claseId/reporte-completo', ctrl.getReporteClaseCompleto);
router.get('/clases/:claseId/exportar-excel', ctrl.exportarReporteExcel);

module.exports = router;
