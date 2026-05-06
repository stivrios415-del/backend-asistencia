const { verificarProfesor } = require('../middleware/auth');
const { getPerfil } = require('../controllers/perfilController');

router.get('/perfil', verificarProfesor, getPerfil);