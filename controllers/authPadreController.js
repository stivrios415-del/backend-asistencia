const { supabase, supabaseAdmin } = require('../config/supabase');

// ============================================
// REGISTRO DE PADRE
// ============================================
const registrarPadre = async (req, res) => {
  console.log('=== INICIO REGISTRO ===');
  
  try {
    const { 
      email, 
      password, 
      nombre, 
      apellido, 
      telefono,
      cedula_hijo,
      institucion_id 
    } = req.body;

    console.log('📝 Datos:', { email, nombre, apellido, cedula_hijo });

    // Validaciones
    if (!email || !password || !nombre || !apellido) {
      console.log('❌ Campos faltantes');
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (password.length < 6) {
      console.log('❌ Password muy corta');
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // 1. Verificar si el email ya está registrado
    console.log('🔍 Verificando email...');
    const { data: existingUser } = await supabase
      .from('usuarios')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    
    if (existingUser) {
      console.log('❌ Email ya existe');
      return res.status(400).json({ error: 'Este correo ya está registrado' });
    }

    // 2. Verificar estudiante
    let estudianteData = null;
    if (cedula_hijo) {
      console.log('🔍 Buscando estudiante:', cedula_hijo);
      const { data: estudiante, error: errEst } = await supabase
        .from('estudiantes')
        .select('cedula, nombre, apellido, grado, seccion, carrera, institucion_id')
        .eq('cedula', cedula_hijo)
        .maybeSingle();

      if (errEst || !estudiante) {
        console.log('❌ Estudiante no encontrado');
        return res.status(404).json({ error: 'No se encontró un estudiante con esa cédula' });
      }
      estudianteData = estudiante;
      console.log('✅ Estudiante encontrado:', estudiante.nombre);
    }

    // 3. Verificar supabaseAdmin
    if (!supabaseAdmin) {
      console.log('❌ supabaseAdmin no disponible');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

    // 4. Crear usuario en Auth
    console.log('👤 Creando usuario en Auth...');
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, apellido, rol: 'padre' }
    });

    if (authError) {
      console.error('❌ Error Auth:', authError.message);
      return res.status(400).json({ error: authError.message });
    }

    if (!authData?.user) {
      console.error('❌ No se creó usuario');
      return res.status(400).json({ error: 'Error al crear usuario' });
    }

    console.log('✅ Usuario Auth creado:', authData.user.id);

    // 5. Insertar en tabla usuarios
    console.log('💾 Insertando en usuarios...');
    const { data: usuarioDB, error: userError } = await supabase
      .from('usuarios')
      .insert({
        id: authData.user.id,
        email,
        nombre,
        apellido,
        telefono: telefono || null,
        rol: 'padre',
        institucion_id: institucion_id || estudianteData?.institucion_id || null
      })
      .select()
      .single();

    if (userError) {
      console.error('❌ Error usuarios:', userError.message);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ error: 'Error al guardar en la base de datos: ' + userError.message });
    }

    console.log('✅ Usuario guardado');

    // 6. Insertar en tabla padres
    console.log('💾 Insertando en padres...');
    const { data: padreData, error: padreError } = await supabase
      .from('padres')
      .insert({
        user_id: usuarioDB.id,
        cedula: `PAD-${Date.now()}`,
        telefono_adicional: telefono || null,
        institucion_id: institucion_id || estudianteData?.institucion_id || null
      })
      .select()
      .single();

    if (padreError) {
      console.error('❌ Error padres:', padreError.message);
      await supabase.from('usuarios').delete().eq('id', usuarioDB.id);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ error: 'Error al crear perfil de padre' });
    }

    console.log('✅ Padre guardado');

    // 7. Vincular estudiante
    if (cedula_hijo && estudianteData) {
      console.log('🔗 Vinculando estudiante...');
      const { error: vinculacionError } = await supabase
        .from('padre_estudiante')
        .insert({
          padre_id: padreData.id,
          estudiante_cedula: cedula_hijo,
          institucion_id: institucion_id || estudianteData.institucion_id
        });

      if (vinculacionError) {
        console.warn('⚠️ Error vinculación:', vinculacionError.message);
      } else {
        console.log('✅ Estudiante vinculado');
      }
    }

    console.log('🎉 REGISTRO EXITOSO');
    
    res.status(201).json({
      success: true,
      message: 'Registro exitoso. Ya puedes iniciar sesión.',
      user: { id: usuarioDB.id, email, nombre, apellido, rol: 'padre' },
      estudianteVinculado: !!cedula_hijo
    });

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
};

// ============================================
// VINCULAR ESTUDIANTE EXISTENTE
// ============================================
const vincularEstudiante = async (req, res) => {
  try {
    const { cedula_hijo } = req.body;
    const padreId = req.user.id;

    if (!cedula_hijo) {
      return res.status(400).json({ error: 'La cédula del estudiante es requerida' });
    }

    const { data: estudiante, error: errEst } = await supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, institucion_id')
      .eq('cedula', cedula_hijo)
      .single();

    if (errEst || !estudiante) {
      return res.status(404).json({ error: 'No se encontró un estudiante con esa cédula' });
    }

    const { data: vinculacionExistente } = await supabase
      .from('padre_estudiante')
      .select('id')
      .eq('padre_id', padreId)
      .eq('estudiante_cedula', cedula_hijo)
      .single();

    if (vinculacionExistente) {
      return res.status(400).json({ error: 'Este estudiante ya está vinculado a tu cuenta' });
    }

    const { error: vinculacionError } = await supabase
      .from('padre_estudiante')
      .insert({
        padre_id: padreId,
        estudiante_cedula: cedula_hijo,
        institucion_id: estudiante.institucion_id
      });

    if (vinculacionError) {
      return res.status(500).json({ error: 'Error al vincular estudiante' });
    }

    res.json({
      success: true,
      message: 'Estudiante vinculado exitosamente',
      estudiante: { cedula: estudiante.cedula, nombre: estudiante.nombre, apellido: estudiante.apellido }
    });

  } catch (error) {
    console.error('Error en vincularEstudiante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// BUSCAR ESTUDIANTE PARA VINCULAR
// ============================================
const buscarEstudianteParaVincular = async (req, res) => {
  try {
    const { cedula } = req.query;
    const institucion_id = req.user.institucion_id;

    if (!cedula) {
      return res.status(400).json({ error: 'La cédula es requerida' });
    }

    let query = supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera')
      .eq('cedula', cedula);

    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }

    const { data: estudiante, error } = await query.single();

    if (error || !estudiante) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    res.json(estudiante);
  } catch (error) {
    console.error('Error en buscarEstudianteParaVincular:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// OBTENER MIS ESTUDIANTES VINCULADOS
// ============================================
const misEstudiantesVinculados = async (req, res) => {
  try {
    const padreId = req.user.id;

    const { data, error } = await supabase
      .from('padre_estudiante')
      .select(`
        estudiante_cedula,
        estudiantes:estudiante_cedula (
          cedula, nombre, apellido, grado, seccion, carrera, foto_url
        )
      `)
      .eq('padre_id', padreId);

    if (error) throw error;

    const hijos = (data || []).map(item => ({
      cedula: item.estudiantes?.cedula,
      nombre: item.estudiantes?.nombre,
      apellido: item.estudiantes?.apellido,
      grado: item.estudiantes?.grado,
      seccion: item.estudiantes?.seccion,
      carrera: item.estudiantes?.carrera || 'General'
    }));

    res.json(hijos);
  } catch (error) {
    console.error('Error en misEstudiantesVinculados:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  registrarPadre,
  vincularEstudiante,
  buscarEstudianteParaVincular,
  misEstudiantesVinculados
};
