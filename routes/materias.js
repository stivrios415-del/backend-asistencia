const express = require('express');
const router = express.Router();
const materiaController = require('../controllers/materiaController');
const { verificarProfesor } = require('../middleware/auth');

// Todas las rutas requieren autenticación y rol de profesor
router.use(verificarProfesor);

router.get('/', materiaController.getMaterias);
router.post('/', materiaController.createMateria);
router.put('/:id', materiaController.updateMateria);
router.delete('/:id', materiaController.deleteMateria);
router.get('/:id/estudiantes', materiaController.getEstudiantesByMateria);
router.post('/:id/estudiantes', materiaController.addEstudiantesToMateria);
router.delete('/:id/estudiantes/:cedula', materiaController.removeEstudianteFromMateria);

module.exports = router;