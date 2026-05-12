const express = require('express');
const router = express.Router();
const { verificarPadre } = require('../middleware/auth');
const {
  registrarPadre,
  vincularEstudiante,
  buscarEstudianteParaVincular,
  misEstudiantesVinculados
} = require('../controllers/authPadreController');

// Registro de padre (público)
router.post('/registro', registrarPadre);

// Rutas protegidas (requieren autenticación)
router.use(verificarPadre);

// Vincular estudiante existente
router.post('/vincular-estudiante', vincularEstudiante);

// Buscar estudiante para vincular
router.get('/buscar-estudiante', buscarEstudianteParaVincular);

// Obtener mis estudiantes vinculados
router.get('/mis-estudiantes', misEstudiantesVinculados);

module.exports = router;