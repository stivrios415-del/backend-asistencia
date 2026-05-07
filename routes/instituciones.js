const express = require('express');
const router = express.Router();
const {
  getInstitucionPorCodigo,
  listarInstituciones,
  crearInstitucion,
} = require('../controllers/institucionesController');

// Buscar institución por código (público — lo usa la app al iniciar)
router.get('/codigo/:codigo', getInstitucionPorCodigo);

// Listar todas (admin del sistema)
router.get('/', listarInstituciones);

// Crear nueva institución (admin del sistema)
router.post('/', crearInstitucion);

module.exports = router;