const { supabase } = require('../config/supabase');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ============================================
// PUSH NOTIFICATION VIA EXPO
// ============================================
const enviarPush = async (expoPushToken, titulo, mensaje, data = {}) => {
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken')) return false;
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: expoPushToken,
        sound: 'default',
        title: titulo,
        body: mensaje,
        data,
        priority: 'high',
        channelId: 'asistencia',
      })
    });
    const result = await response.json();
    const ok = result?.data?.status === 'ok';
    console.log(`📱 Push ${ok ? '✅' : '❌'} → ${expoPushToken.slice(0, 30)}...`);
    return ok;
  } catch (error) {
    console.error('❌ Error push:', error.message);
    return false;
  }
};

// ============================================
// EMAIL VIA RESEND
// ── En sandbox solo puede enviar al email del dueño de la API key.
// ── Cuando verifiques un dominio en resend.com/domains, pon el dominio
//    en RESEND_FROM_DOMAIN y los emails irán al padre real.
// ============================================
const enviarEmail = async (emailDestino, nombrePadre, nombreEstudiante, tipo, mensajeHtml) => {
  if (!process.env.RESEND_API_KEY || !emailDestino) return false;
  try {
    const emojis  = { falta: '⚠️', tardanza: '🕐', muchas_ausencias: '🔴' };
    const colores = { falta: '#F59E0B', tardanza: '#3B82F6', muchas_ausencias: '#EF4444' };
    const emoji   = emojis[tipo]  || '📢';
    const color   = colores[tipo] || '#143C65';

    // ── Sandbox: si no hay dominio verificado, mandar al email del owner ──
    const dominioVerificado = process.env.RESEND_FROM_DOMAIN;
    const emailReal = dominioVerificado
      ? emailDestino                          // dominio verificado → email del padre
      : (process.env.RESEND_SANDBOX_EMAIL || 'stivrios415@gmail.com'); // sandbox → tu email

    const fromEmail = dominioVerificado
      ? `Asistencia Escolar <noreply@${dominioVerificado}>`
      : (process.env.EMAIL_FROM || 'onboarding@resend.dev');

    if (!dominioVerificado) {
      console.log(`📧 Sandbox: email redirigido de ${emailDestino} → ${emailReal}`);
    }

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: emailReal,
      subject: `${emoji} Notificación de asistencia — ${nombreEstudiante}`,
      html: `
        <!DOCTYPE html><html>
        <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:30px 15px;">
              <table width="600" cellpadding="0" cellspacing="0"
                style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="background:#143C65;padding:24px;text-align:center;">
                    <h1 style="color:white;margin:0;font-size:20px;">🏫 Sistema de Asistencia Escolar</h1>
                  </td>
                </tr>
                <tr>
                  <td style="background:${color};padding:12px 24px;">
                    <p style="color:white;margin:0;font-size:15px;font-weight:bold;">${emoji} Notificación de asistencia</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 24px;">
                    <p style="font-size:16px;color:#333;margin-top:0;">
                      Estimado/a <strong>${nombrePadre}</strong>,
                    </p>
                    ${!dominioVerificado ? `
                    <div style="background:#FFF3CD;border-left:4px solid #F59E0B;padding:12px;border-radius:6px;margin-bottom:16px;">
                      <p style="margin:0;font-size:13px;color:#856404;">
                        📬 Esta notificación corresponde al padre/madre de <strong>${nombreEstudiante}</strong>
                        (${emailDestino}) — modo sandbox activo.
                      </p>
                    </div>` : ''}
                    <div style="background:#FFF8E1;border-left:4px solid ${color};padding:16px;border-radius:6px;margin:16px 0;">
                      <p style="margin:0;font-size:15px;color:#333;line-height:1.6;">${mensajeHtml}</p>
                    </div>
                    <p style="color:#666;font-size:13px;line-height:1.6;">
                      Puedes ver más detalles en la aplicación de padres.<br/>
                      Si tienes preguntas, comunícate con el centro educativo.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9f9f9;padding:16px 24px;border-top:1px solid #eee;text-align:center;">
                    <p style="color:#999;font-size:11px;margin:0;">Mensaje automático — Sistema de Control de Asistencia</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>
      `
    });

    if (error) { console.error('❌ Resend:', error.message); return false; }
    console.log(`📧 Email ✅ → ${emailReal}${!dominioVerificado ? ' (sandbox)' : ''}`);
    return true;
  } catch (error) {
    console.error('❌ Error email:', error.message);
    return false;
  }
};

// ============================================
// CORE: NOTIFICAR A TODOS LOS PADRES DE UN ESTUDIANTE
// ============================================
const notificarPadresDeEstudiante = async (cedula, tipo, titulo, mensajePush, mensajeEmailHtml, extra = {}) => {
  try {
    const { data: vinculaciones } = await supabase
      .from('padre_estudiante').select('padre_id').eq('estudiante_cedula', cedula);
    if (!vinculaciones || vinculaciones.length === 0) return;

    const padreIds = vinculaciones.map(v => v.padre_id);
    const { data: padres } = await supabase
      .from('padres').select('id, user_id, expo_push_token').in('id', padreIds);
    if (!padres || padres.length === 0) return;

    const userIds = padres.map(p => p.user_id);
    const { data: usuarios } = await supabase
      .from('usuarios').select('id, email, nombre, apellido').in('id', userIds);

    for (const padre of padres) {
      const usuario = usuarios?.find(u => u.id === padre.user_id);
      if (!usuario) continue;
      const nombrePadre = `${usuario.nombre} ${usuario.apellido}`;

      const pushOk = padre.expo_push_token
        ? await enviarPush(padre.expo_push_token, titulo, mensajePush, { tipo, cedula, ...extra })
        : false;

      const emailOk = usuario.email
        ? await enviarEmail(usuario.email, nombrePadre, extra.nombreEstudiante || cedula, tipo, mensajeEmailHtml)
        : false;

      await supabase.from('notificaciones_padres').insert({
        padre_id: padre.id,
        estudiante_cedula: cedula,
        tipo, titulo,
        mensaje: mensajePush,
        enviado_email: emailOk,
        enviado_push: pushOk
      });

      console.log(`✅ Notificado ${nombrePadre} — push:${pushOk} email:${emailOk}`);
    }
  } catch (error) {
    console.error('❌ notificarPadresDeEstudiante:', error.message);
  }
};

// ============================================
// NOTIFICAR FALTA
// ============================================
const notificarFalta = async (cedula, fecha, institucion_id) => {
  try {
    const { data: est } = await supabase
      .from('estudiantes').select('nombre, apellido, grado, seccion')
      .eq('cedula', cedula).maybeSingle();
    if (!est) return;

    const inicioMes = new Date(); inicioMes.setDate(1);
    const inicioMesStr = inicioMes.toISOString().split('T')[0];
    const { count } = await supabase.from('asistencia')
      .select('id', { count: 'exact', head: true })
      .eq('cedula', cedula).gte('fecha', inicioMesStr).lte('fecha', fecha);

    const dias      = Math.ceil((new Date(fecha) - new Date(inicioMesStr)) / 86400000) + 1;
    const faltas    = Math.max(0, dias - (count || 0));
    const nombreEst = `${est.nombre} ${est.apellido}`;
    const grado     = `${est.grado}° ${est.seccion}`;

    let tipo, titulo, push, email;
    if (faltas >= 5) {
      tipo = 'muchas_ausencias'; titulo = '🔴 Alerta crítica de ausencias';
      push  = `${nombreEst} acumula ${faltas} faltas este mes. Comuníquese con el colegio urgentemente.`;
      email = `Su hijo/a <strong>${nombreEst}</strong> (${grado}) acumula <strong>${faltas} faltas</strong> este mes. Le pedimos comunicarse con la coordinación académica a la brevedad.`;
    } else if (faltas >= 3) {
      tipo = 'muchas_ausencias'; titulo = '⚠️ Ausencias repetidas';
      push  = `${nombreEst} tiene ${faltas} faltas este mes.`;
      email = `Su hijo/a <strong>${nombreEst}</strong> (${grado}) registra <strong>${faltas} faltas</strong> este mes. Le recomendamos estar pendiente de su asistencia.`;
    } else {
      tipo = 'falta'; titulo = '📋 Ausencia registrada';
      push  = `${nombreEst} no asistió hoy (${fecha}).`;
      email = `Su hijo/a <strong>${nombreEst}</strong> (${grado}) <strong>no asistió</strong> el día <strong>${fecha}</strong>.`;
    }

    await notificarPadresDeEstudiante(cedula, tipo, titulo, push, email, {
      nombreEstudiante: nombreEst, fecha, faltas
    });
  } catch (error) {
    console.error('❌ notificarFalta:', error.message);
  }
};

// ============================================
// NOTIFICAR TARDANZA
// ============================================
const notificarTardanza = async (cedula, fecha, hora, horaLimite = '07:30') => {
  try {
    const { data: est } = await supabase
      .from('estudiantes').select('nombre, apellido, grado, seccion')
      .eq('cedula', cedula).maybeSingle();
    if (!est) return;

    const nombreEst = `${est.nombre} ${est.apellido}`;
    const grado     = `${est.grado}° ${est.seccion}`;
    const push      = `${nombreEst} llegó tarde hoy (${hora}).`;
    const email     = `Su hijo/a <strong>${nombreEst}</strong> (${grado}) llegó tarde el <strong>${fecha}</strong> a las <strong>${hora}</strong>. La hora de entrada es ${horaLimite}.`;

    await notificarPadresDeEstudiante(cedula, 'tardanza', '🕐 Llegada tarde', push, email, {
      nombreEstudiante: nombreEst, fecha, hora
    });
  } catch (error) {
    console.error('❌ notificarTardanza:', error.message);
  }
};

// ============================================
// ACTUALIZAR PUSH TOKEN
// ============================================
const actualizarPushToken = async (req, res) => {
  try {
    const { expo_push_token } = req.body;
    const userId = req.user.id;
    if (!expo_push_token) return res.status(400).json({ error: 'Token requerido' });
    const { data: padreRow } = await supabase
      .from('padres').select('id').eq('user_id', userId).maybeSingle();
    if (!padreRow) return res.status(404).json({ error: 'Perfil de padre no encontrado' });
    await supabase.from('padres').update({ expo_push_token }).eq('id', padreRow.id);
    console.log(`📱 Push token actualizado — padre ${padreRow.id}`);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Error interno' });
  }
};

// ============================================
// OBTENER NOTIFICACIONES DEL PADRE
// ============================================
const getMisNotificaciones = async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: padreRow } = await supabase
      .from('padres').select('id').eq('user_id', userId).maybeSingle();
    if (!padreRow) return res.json([]);
    const { data, error } = await supabase
      .from('notificaciones_padres').select('*')
      .eq('padre_id', padreRow.id)
      .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ error: 'Error interno' });
  }
};

// ============================================
// MARCAR NOTIFICACIÓN LEÍDA
// ============================================
const marcarNotificacionLeida = async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('notificaciones_padres').update({ leida: true }).eq('id', id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Error interno' });
  }
};

module.exports = {
  notificarFalta, notificarTardanza,
  actualizarPushToken, getMisNotificaciones, marcarNotificacionLeida
};
