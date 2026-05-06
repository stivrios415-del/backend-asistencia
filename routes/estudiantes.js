const express = require('express');
const multer = require('multer');
const router = express.Router();
const { verificarProfesor } = require('../middleware/auth');
const estudianteController = require('../controllers/estudianteController');

const upload = multer({ storage: multer.memoryStorage() });

router.use(verificarProfesor);

router.get('/', estudianteController.getEstudiantes);
router.get('/grados-secciones', estudianteController.getGradosSecciones);
router.get('/:cedula', estudianteController.getEstudianteByCedula);
router.post('/', estudianteController.createEstudiante);
router.post('/bulk-upload', upload.single('archivo'), estudianteController.bulkUploadEstudiantes);
router.put('/:cedula', estudianteController.updateEstudiante);
router.delete('/:cedula', estudianteController.deleteEstudiante);

module.exports = router;
