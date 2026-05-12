const express = require('express');
const router = express.Router();
const { verificarToken, verificarPadre } = require('../middleware/auth');
const {
  registrarPadre,
  vincularEstudiante,
  buscarEstudianteParaVincular,
  misEstudiantesVinculados
} = require('../controllers/authPadreController');

// Ruta pública
router.post('/registro', registrarPadre);

// Rutas protegidas
router.use(verificarToken);
router.use(verificarPadre);

router.post('/vincular-estudiante', vincularEstudiante);
router.get('/buscar-estudiante', buscarEstudianteParaVincular);
router.get('/mis-estudiantes', misEstudiantesVinculados);

module.exports = router;
