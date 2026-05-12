const { supabase, supabaseAdmin } = require('../config/supabase');

// ============================================
// REGISTRO DE PADRE
// ============================================
const registrarPadre = async (req, res) => {
  console.log('=== INICIO REGISTRO ===');
  const totalStart = Date.now();

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

    console.log('📝 Datos recibidos:', { email, nombre, apellido, cedula_hijo, institucion_id });

    // ── Validaciones básicas ──────────────────────────────────
    if (!email || !password || !nombre || !apellido) {
      console.log('❌ Campos faltantes');
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (password.length < 6) {
      console.log('❌ Password muy corta');
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // ── 1. Verificar supabaseAdmin antes de continuar ─────────
    if (!supabaseAdmin) {
      console.error('❌ supabaseAdmin no disponible — revisa SUPABASE_SERVICE_ROLE_KEY en .env');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

    // ── 2. Verificar si el email ya está registrado ───────────
    console.log('🔍 Verificando email...');
    let t = Date.now();
    const { data: existingUser, error: emailCheckError } = await supabase
      .from('usuarios')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    console.log(`⏱️ Email check: ${Date.now() - t}ms`);

    if (emailCheckError) {
      console.error('❌ Error verificando email:', emailCheckError.message);
      return res.status(500).json({ error: 'Error al verificar el correo' });
    }

    if (existingUser) {
      console.log('❌ Email ya existe');
      return res.status(400).json({ error: 'Este correo ya está registrado' });
    }

    // ── 3. Verificar estudiante (si se proporcionó cédula) ────
    let estudianteData = null;
    if (cedula_hijo) {
      console.log('🔍 Buscando estudiante con cédula:', cedula_hijo);
      t = Date.now();
      const { data: estudiante, error: errEst } = await supabase
        .from('estudiantes')
        .select('cedula, nombre, apellido, grado, seccion, carrera, institucion_id')
        .eq('cedula', cedula_hijo)
        .maybeSingle();
      console.log(`⏱️ Búsqueda estudiante: ${Date.now() - t}ms`);

      if (errEst) {
        console.error('❌ Error buscando estudiante:', errEst.message);
        return res.status(500).json({ error: 'Error al buscar el estudiante' });
      }

      if (!estudiante) {
        console.log('❌ Estudiante no encontrado para cédula:', cedula_hijo);
        return res.status(404).json({ error: 'No se encontró un estudiante con esa cédula' });
      }

      estudianteData = estudiante;
      console.log('✅ Estudiante encontrado:', estudiante.nombre, estudiante.apellido);
    }

    // ── 4. Crear usuario en Supabase Auth ─────────────────────
    console.log('👤 Creando usuario en Auth...');
    t = Date.now();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, apellido, rol: 'padre' }
    });
    console.log(`⏱️ Auth createUser: ${Date.now() - t}ms`);

    if (authError) {
      console.error('❌ Error Auth:', authError.message);
      // Mensaje amigable para email duplicado en Auth
      if (authError.message.includes('already been registered') || authError.message.includes('already registered')) {
        return res.status(400).json({ error: 'Este correo ya está registrado' });
      }
      return res.status(400).json({ error: authError.message });
    }

    if (!authData?.user) {
      console.error('❌ Auth no retornó usuario');
      return res.status(400).json({ error: 'Error al crear el usuario' });
    }

    const userId = authData.user.id;
    console.log('✅ Usuario Auth creado. ID:', userId);

    // ── 5. Insertar en tabla usuarios ─────────────────────────
    console.log('💾 Insertando en tabla usuarios...');
    t = Date.now();
    const { data: usuarioDB, error: userError } = await supabase
      .from('usuarios')
      .insert({
        id: userId,
        email,
        nombre,
        apellido,
        telefono: telefono || null,
        rol: 'padre',
        password_hash: 'supabase_auth',
        institucion_id: institucion_id || estudianteData?.institucion_id || null
      })
      .select()
      .single();
    console.log(`⏱️ Insert usuarios: ${Date.now() - t}ms`);

    if (userError) {
      console.error('❌ Error insertando en usuarios:', userError.message);
      // Rollback: eliminar usuario de Auth
      await supabaseAdmin.auth.admin.deleteUser(userId);
      console.log('🔄 Rollback Auth realizado');
      return res.status(500).json({ error: 'Error al guardar el usuario: ' + userError.message });
    }

    console.log('✅ Usuario guardado en BD');

    // ── 6. Insertar en tabla padres ───────────────────────────
    console.log('💾 Insertando en tabla padres...');
    t = Date.now();
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
    console.log(`⏱️ Insert padres: ${Date.now() - t}ms`);

    if (padreError) {
      console.error('❌ Error insertando en padres:', padreError.message);
      // Rollback
      await supabase.from('usuarios').delete().eq('id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      console.log('🔄 Rollback completo realizado');
      return res.status(500).json({ error: 'Error al crear el perfil de padre' });
    }

    console.log('✅ Padre guardado en BD');

    // ── 7. Vincular estudiante (si aplica) ────────────────────
    let estudianteVinculado = false;
    if (cedula_hijo && estudianteData && padreData) {
      console.log('🔗 Vinculando estudiante al padre...');
      t = Date.now();
      const { error: vinculacionError } = await supabase
        .from('padre_estudiante')
        .insert({
          padre_id: padreData.id,
          estudiante_cedula: cedula_hijo,
          institucion_id: institucion_id || estudianteData.institucion_id
        });
      console.log(`⏱️ Vinculación: ${Date.now() - t}ms`);

      if (vinculacionError) {
        // No es crítico, el padre quedó creado
        console.warn('⚠️ Error en vinculación (no crítico):', vinculacionError.message);
      } else {
        console.log('✅ Estudiante vinculado exitosamente');
        estudianteVinculado = true;
      }
    }

    console.log(`🎉 REGISTRO EXITOSO — Total: ${Date.now() - totalStart}ms`);

    return res.status(201).json({
      success: true,
      message: 'Registro exitoso. Ya puedes iniciar sesión.',
      user: {
        id: usuarioDB.id,
        email,
        nombre,
        apellido,
        rol: 'padre'
      },
      estudianteVinculado
    });

  } catch (error) {
    console.error(`❌ ERROR INESPERADO (${Date.now() - totalStart}ms):`, error.message);
    console.error(error.stack);
    return res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
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
      .maybeSingle();

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
      console.error('Error vinculando estudiante:', vinculacionError.message);
      return res.status(500).json({ error: 'Error al vincular estudiante' });
    }

    return res.json({
      success: true,
      message: 'Estudiante vinculado exitosamente',
      estudiante: {
        cedula: estudiante.cedula,
        nombre: estudiante.nombre,
        apellido: estudiante.apellido
      }
    });

  } catch (error) {
    console.error('Error en vincularEstudiante:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// BUSCAR ESTUDIANTE PARA VINCULAR
// ============================================
const buscarEstudianteParaVincular = async (req, res) => {
  try {
    const { cedula } = req.query;
    const institucion_id = req.user?.institucion_id;

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

    const { data: estudiante, error } = await query.maybeSingle();

    if (error || !estudiante) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    return res.json(estudiante);

  } catch (error) {
    console.error('Error en buscarEstudianteParaVincular:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
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

    if (error) {
      console.error('Error obteniendo estudiantes vinculados:', error.message);
      throw error;
    }

    const hijos = (data || []).map(item => ({
      cedula: item.estudiantes?.cedula,
      nombre: item.estudiantes?.nombre,
      apellido: item.estudiantes?.apellido,
      grado: item.estudiantes?.grado,
      seccion: item.estudiantes?.seccion,
      carrera: item.estudiantes?.carrera || 'General'
    }));

    return res.json(hijos);

  } catch (error) {
    console.error('Error en misEstudiantesVinculados:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  registrarPadre,
  vincularEstudiante,
  buscarEstudianteParaVincular,
  misEstudiantesVinculados
};
