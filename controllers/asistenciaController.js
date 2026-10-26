const { supabase } = require('../config/supabase');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { notificarTardanza, notificarAsistencia, notificarFaltaClase } = require('../services/notificacionService');

const HORA_LIMITE_TARDANZA = '07:30';
const ZONA_HORARIA = 'America/Tegucigalpa';

function fechaHondurasHoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
}

function horaHondurasAhora() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: ZONA_HORARIA });
}

function formatearFechaHonduras(date) {
  return date.toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function obtenerInstitucion(institucion_id) {
  if (!institucion_id) return { nombre: 'Sistema de Asistencia', color_primario: '#143C65', color_secundario: '#256D5B' };
  const { data, error } = await supabase.from('instituciones')
    .select('nombre, color_primario, color_secundario, logo_url').eq('id', institucion_id).single();
  if (error || !data) return { nombre: 'Sistema de Asistencia', color_primario: '#143C65', color_secundario: '#256D5B' };
  return data;
}

function hexToArgb(hex) { return `FF${hex.replace('#', '').toUpperCase()}`; }

function generarChartBarrasXml(series, titulo, colorPrimario = '143C65', colorSecundario = '256D5B') {
  const colores = [colorPrimario, 'E53E3E', colorSecundario, 'F18F01', 'A23B72'];
  const seriesXml = series.map((s, sIdx) => {
    const color = colores[sIdx % colores.length];
    const ptsCat = s.categorias.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeXml(String(c))}</c:v></c:pt>`).join('');
    const ptsVal = s.valores.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v)}</c:v></c:pt>`).join('');
    return `<c:ser><c:idx val="${sIdx}"/><c:order val="${sIdx}"/>
      <c:tx><c:strRef><c:f/><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(s.nombre)}</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
      <c:invertIfNegative val="0"/>
      <c:cat><c:strRef><c:f/><c:strCache><c:ptCount val="${s.categorias.length}"/>${ptsCat}</c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f/><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${s.valores.length}"/>${ptsVal}</c:numCache></c:numRef></c:val>
    </c:ser>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>
    <a:p><a:pPr><a:defRPr b="1" sz="1400"/></a:pPr><a:r><a:rPr b="1"/><a:t>${escapeXml(titulo)}</a:t></a:r></a:p>
  </c:rich></c:tx><c:overlay val="0"/></c:title>
  <c:autoTitleDeleted val="0"/>
  <c:plotArea><c:layout/>
    <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:gapWidth val="150"/>
      ${seriesXml}<c:axId val="10001"/><c:axId val="10002"/>
    </c:barChart>
    <c:catAx><c:axId val="10001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>
      <c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/>
      <c:spPr><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></c:spPr>
      <c:txPr><a:bodyPr rot="-2700000" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0"/></a:pPr></a:p></c:txPr>
      <c:crossAx val="10002"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>
    </c:catAx>
    <c:valAx><c:axId val="10002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>
      <c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/>
      <c:crossAx val="10001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>
    </c:valAx>
  </c:plotArea>
  <c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
  <c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/>
  </c:chart></c:chartSpace>`;
}

function generarChartPieXml(categorias, valores, titulo) {
  const ptsCat = categorias.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeXml(String(c))}</c:v></c:pt>`).join('');
  const ptsVal = valores.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v)}</c:v></c:pt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>
    <a:p><a:pPr><a:defRPr b="1" sz="1400"/></a:pPr><a:r><a:rPr b="1"/><a:t>${escapeXml(titulo)}</a:t></a:r></a:p>
  </c:rich></c:tx><c:overlay val="0"/></c:title>
  <c:autoTitleDeleted val="0"/>
  <c:plotArea><c:layout/>
    <c:pieChart><c:varyColors val="1"/>
      <c:ser><c:idx val="0"/><c:order val="0"/>
        <c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/></c:spPr>
          <c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/>
          <c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:separator> - </c:separator>
        </c:dLbls>
        <c:cat><c:strRef><c:f/><c:strCache><c:ptCount val="${categorias.length}"/>${ptsCat}</c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:f/><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${valores.length}"/>${ptsVal}</c:numCache></c:numRef></c:val>
      </c:ser>
    </c:pieChart>
  </c:plotArea>
  <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
  <c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/>
  </c:chart></c:chartSpace>`;
}

async function inyectarGraficasEnXlsx(workbookBuffer, graficas) {
  const zip = await JSZip.loadAsync(workbookBuffer);
  let wbXml = await zip.file('xl/workbook.xml').async('string');
  let wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  let contentTypes = await zip.file('[Content_Types].xml').async('string');
  const sheetMatches = wbXml.match(/<sheet /g) || [];
  let sheetCount = sheetMatches.length;
  let maxRId = (wbRels.match(/Id="rId(\d+)"/g) || []).reduce((max, m) => { const n = parseInt(m.match(/\d+/)[0]); return n > max ? n : max; }, 0);
  graficas.forEach((grafica, idx) => {
    sheetCount++; maxRId++;
    const chartId = idx + 1, drawingId = idx + 1, sheetId = sheetCount, rId = `rId${maxRId}`;
    const nombre = grafica.nombre || `Grafica${chartId}`;
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/><drawing r:id="rId1"/></worksheet>`;
    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:absoluteAnchor><xdr:pos x="228600" y="228600"/><xdr:ext cx="9144000" cy="6858000"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId+2}" name="Chart ${chartId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="228600" y="228600"/><a:ext cx="9144000" cy="6858000"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`;
    const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartId}.xml"/></Relationships>`;
    const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingId}.xml"/></Relationships>`;
    zip.file(`xl/charts/chart${chartId}.xml`, grafica.chartXml);
    zip.file(`xl/drawings/drawing${drawingId}.xml`, drawingXml);
    zip.file(`xl/drawings/_rels/drawing${drawingId}.xml.rels`, drawingRelsXml);
    zip.file(`xl/worksheets/sheet${sheetId}.xml`, sheetXml);
    zip.file(`xl/worksheets/_rels/sheet${sheetId}.xml.rels`, sheetRelsXml);
    wbXml = wbXml.replace('</sheets>', `<sheet name="${nombre}" sheetId="${sheetId}" r:id="${rId}"/></sheets>`);
    wbRels = wbRels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetId}.xml"/></Relationships>`);
    contentTypes = contentTypes.replace('</Types>',
      `<Override PartName="/xl/worksheets/sheet${sheetId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/charts/chart${chartId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
      `<Override PartName="/xl/drawings/drawing${drawingId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  });
  zip.file('xl/workbook.xml', wbXml); zip.file('xl/_rels/workbook.xml.rels', wbRels); zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function normalizarTexto(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function contarFaltasEnMes(cedula, año, mes) {
  const primerDia = formatearFechaHonduras(new Date(año, mes - 1, 1));
  const hoy = new Date();
  const ultimoDia = (año === hoy.getFullYear() && mes === hoy.getMonth() + 1)
    ? fechaHondurasHoy()
    : formatearFechaHonduras(new Date(año, mes, 0));
  const { data, error } = await supabase.from('asistencia').select('fecha').eq('cedula', cedula)
    .gte('fecha', primerDia).lte('fecha', ultimoDia);
  if (error) return 0;
  const diasTotales = Math.ceil((new Date(ultimoDia) - new Date(primerDia)) / 86400000) + 1;
  const faltas = diasTotales - data.length;
  return faltas > 0 ? faltas : 0;
}

async function obtenerFiltrosProfesor(profesorEmail, institucion_id) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;
  let { data: profesor } = await supabase.from('profesores').select('id, nombre').eq('email', profesorEmail.trim().toLowerCase()).single();
  if (!profesor) { const { data: p2 } = await supabase.from('profesores').select('id, nombre').eq('email', profesorEmail.trim()).single(); profesor = p2; }
  if (!profesor) return [];
  const { data: asignaciones } = await supabase.from('profesor_asignaciones').select('grado, carrera').eq('profesor_id', profesor.id);
  return asignaciones || [];
}

async function obtenerIdsMateriaProfesor(profesorEmail, institucion_id) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;
  let { data: profesor } = await supabase.from('profesores').select('id').eq('email', profesorEmail.trim()).single();
  if (!profesor) { const { data: p2 } = await supabase.from('profesores').select('id').eq('email', profesorEmail.trim().toLowerCase()).single(); profesor = p2; }
  if (!profesor) return [];
  let q = supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  if (institucion_id) q = q.eq('institucion_id', institucion_id);
  const { data: materias } = await q;
  return materias ? materias.map(m => m.id) : [];
}

async function obtenerEstudiantesFiltrados(filtros, institucion_id) {
  let q = supabase.from('estudiantes').select('cedula, nombre, apellido, grado, seccion, carrera').order('apellido', { ascending: true });
  if (institucion_id) q = q.eq('institucion_id', institucion_id);
  const { data, error } = await q;
  if (error) throw error;
  if (filtros === null) return data.filter(est => est.carrera && est.carrera.trim() !== '');
  if (filtros.length === 0) return [];
  return data.filter(est => {
    if (!est.carrera || est.carrera.trim() === '') return false;
    return filtros.some(f => normalizarTexto(String(f.grado)) === normalizarTexto(String(est.grado)) && normalizarTexto(f.carrera) === normalizarTexto(est.carrera));
  });
}

// ========== REGISTRAR ASISTENCIA ==========
const registrarAsistencia = async (req, res) => {
  const { cedula, materiaId } = req.body;
  const institucion_id = req.user.institucion_id;
  if (!cedula) return res.status(400).json({ error: 'Cédula no proporcionada' });
  if (!materiaId) return res.status(400).json({ error: 'Debe especificar la materia/clase' });
  const { data: materia, error: errMateria } = await supabase.from('materias').select('grado, carrera, nombre, profesor_id, profesores:profesor_id(nombre)').eq('id', materiaId).single();
  if (errMateria || !materia) return res.status(404).json({ error: 'La clase seleccionada no existe' });
  const { data: estudiante, error: errEstudiante } = await supabase.from('estudiantes')
    .select('cedula, nombre, apellido, grado, seccion, carrera, foto_url').eq('cedula', cedula).single();
  if (errEstudiante || !estudiante) return res.status(404).json({ error: 'Estudiante no encontrado' });
  if (normalizarTexto(String(estudiante.grado)) !== normalizarTexto(String(materia.grado)) ||
      normalizarTexto(estudiante.carrera) !== normalizarTexto(materia.carrera)) {
    return res.status(400).json({ error: `Este estudiante no pertenece a esta clase. Solo se permite para grado ${materia.grado} - ${materia.carrera}.` });
  }
  const hoy = fechaHondurasHoy();
  const ahora = horaHondurasAhora();

  // ✅ Ya NO se envía la notificación de tardanza aquí. Solo se guarda.
  const { error: errAsistencia } = await supabase.from('asistencia')
    .insert([{ cedula, fecha: hoy, hora: ahora, materia_id: materiaId, institucion_id, estado: 'presente' }]);

  if (errAsistencia) {
    if (errAsistencia.code === '23505') {
      return res.status(400).json({ error: 'Este estudiante ya registró asistencia en esta clase hoy', estudiante });
    }
    return res.status(500).json({ error: 'Error al registrar asistencia: ' + errAsistencia.message });
  }

  res.json({
    message: 'Asistencia registrada exitosamente',
    estudiante: { cedula: estudiante.cedula, nombre: estudiante.nombre, apellido: estudiante.apellido, grado: estudiante.grado, seccion: estudiante.seccion, carrera: estudiante.carrera || 'No especificada', foto_url: estudiante.foto_url || null },
    hora: ahora
  });
};

// ========== ASISTENCIA DEL DÍA ==========
const getAsistenciaHoy = async (req, res) => {
  const hoy = fechaHondurasHoy();
  const añoActual = new Date().getFullYear();
  const mesActual = new Date().getMonth() + 1;
  const { profesorEmail } = req.query;
  const institucion_id = req.user.institucion_id;
  if (!profesorEmail) return res.status(400).json({ error: 'Se necesita el email del profesor' });
  const { data: profesor, error: errProf } = await supabase.from('profesores').select('id').eq('email', profesorEmail).single();
  if (errProf || !profesor) return res.status(404).json({ error: 'Profesor no encontrado' });
  let queryMaterias = supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  if (institucion_id) queryMaterias = queryMaterias.eq('institucion_id', institucion_id);
  const { data: materias } = await queryMaterias;
  if (!materias || materias.length === 0) return res.json([]);
  let queryAsistencia = supabase.from('asistencia').select(`
    id, fecha, hora, materia_id, estado,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
    materias (nombre)
  `).eq('fecha', hoy).in('materia_id', materias.map(m => m.id));
  if (institucion_id) queryAsistencia = queryAsistencia.eq('institucion_id', institucion_id);
  const { data, error } = await queryAsistencia;
  if (error) return res.status(400).json({ error: error.message });
  const result = await Promise.all(data.map(async item => ({
    id: item.id, fecha: item.fecha, hora: item.hora, estado: item.estado || 'presente',
    materia_id: item.materia_id,
    estudiante: item.estudiantes,
    materia_nombre: item.materias?.nombre || 'Sin materia',
    faltasEnMes: item.estudiantes?.cedula ? await contarFaltasEnMes(item.estudiantes.cedula, añoActual, mesActual) : 0
  })));
  res.json(result);
};

const getAsistenciaByFecha = async (req, res) => {
  const { fecha } = req.params; const institucion_id = req.user.institucion_id;
  let query = supabase.from('asistencia').select(`id, fecha, hora, estado, estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)`).eq('fecha', fecha);
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

const getAsistenciaPorGrado = async (req, res) => {
  const { grado, seccion, fecha } = req.query; const institucion_id = req.user.institucion_id;
  const fechaFiltro = fecha || fechaHondurasHoy();
  let query = supabase.from('asistencia').select(`id, fecha, hora, estado, estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)`).eq('fecha', fechaFiltro);
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  let filtrados = data;
  if (grado) filtrados = filtrados.filter(a => a.estudiantes?.grado === grado);
  if (seccion) filtrados = filtrados.filter(a => a.estudiantes?.seccion === seccion);
  res.json(filtrados);
};

const limpiarAsistenciaHoy = async (req, res) => {
  const hoy = fechaHondurasHoy(); const institucion_id = req.user.institucion_id;
  let query = supabase.from('asistencia').delete().eq('fecha', hoy).neq('estado', 'excusado');
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Asistencia del día limpiada (excusados conservados)' });
};

const getReporteAsistencia = async (req, res) => {
  const { fechaInicio, fechaFin, profesorEmail } = req.query; const institucion_id = req.user.institucion_id;
  let query = supabase.from('asistencia').select(`id, fecha, hora, materia_id, estado, estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url), materias (nombre, grado, seccion, carrera, profesor_id)`);
  if (fechaInicio && fechaFin) query = query.gte('fecha', fechaInicio).lte('fecha', fechaFin);
  else if (fechaInicio) query = query.gte('fecha', fechaInicio);
  else if (fechaFin) query = query.lte('fecha', fechaFin);
  if (profesorEmail && profesorEmail !== 'all' && profesorEmail !== '') {
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail, institucion_id);
    if (!idsMaterias || idsMaterias.length === 0) return res.json([]);
    query = query.in('materia_id', idsMaterias);
  }
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query.order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data.map(item => ({
    ...item,
    materia_nombre: item.materias?.nombre || 'Sin materia',
    estado: item.estado || 'presente'
  })));
};

// ========== FINALIZAR CLASE (Aquí se envían TODAS las notificaciones) ==========
const finalizarClase = async (req, res) => {
  const { materiaId, nombreProfesor, nombreMateria } = req.body;
  const institucion_id = req.user.institucion_id;
  if (!materiaId) return res.status(400).json({ error: 'Falta materiaId' });

  try {
    const hoy = fechaHondurasHoy();

    const { error: errCandado } = await supabase
      .from('clases_finalizadas')
      .insert([{ materia_id: materiaId, fecha: hoy, institucion_id }]);

    if (errCandado) {
      if (errCandado.code === '23505') {
        return res.status(200).json({
          success: true,
          yaFinalizada: true,
          mensaje: 'Esta clase ya había sido finalizada hoy. No se enviaron notificaciones nuevamente.'
        });
      }
      console.error('❌ Error verificando candado de finalizarClase:', errCandado.message);
      return res.status(500).json({ error: 'No se pudo verificar el estado de la clase: ' + errCandado.message });
    }

    const { data: materia, error: errMat } = await supabase
      .from('materias').select('grado, carrera, nombre').eq('id', materiaId).single();
    if (errMat || !materia) return res.status(404).json({ error: 'Materia no encontrada' });

    const normalizarTextoLocal = (str) => (str || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    let qEst = supabase.from('estudiantes')
      .select('cedula, nombre, apellido, carrera')
      .eq('grado', materia.grado);
    if (institucion_id) qEst = qEst.eq('institucion_id', institucion_id);
    const { data: todosEstudiantesRaw } = await qEst;

    const carreraNorm = normalizarTextoLocal(materia.carrera);
    const todosEstudiantes = (todosEstudiantesRaw || []).filter(e =>
      normalizarTextoLocal(e.carrera) === carreraNorm
    );

    if (!todosEstudiantes || todosEstudiantes.length === 0) {
      return res.json({ success: true, presentes: 0, ausentes: 0 });
    }

    // ✅ Ahora traemos también la HORA en la que se registró cada estudiante
    const { data: asistidos } = await supabase
      .from('asistencia').select('cedula, hora')
      .eq('fecha', hoy).eq('materia_id', materiaId);
    
    // Mapeamos cédula -> hora de registro
    const mapaPresentes = new Map();
    (asistidos || []).forEach(a => mapaPresentes.set(a.cedula, a.hora));

    const totalPresentes = mapaPresentes.size;
    const totalAusentes  = todosEstudiantes.length - totalPresentes;

    res.json({ success: true, presentes: totalPresentes, ausentes: totalAusentes });

    const nombreClase = nombreMateria || materia.nombre || materia.carrera;

    // ✅ Aquí disparamos TODAS las notificaciones (Tardanza, Asistencia normal, o Falta)
    for (const est of todosEstudiantes) {
      try {
        if (mapaPresentes.has(est.cedula)) {
          const horaRegistro = mapaPresentes.get(est.cedula);
          
          // Revisamos si fue tardanza
          const [hLim, mLim] = HORA_LIMITE_TARDANZA.split(':').map(Number);
          const [hReg, mReg] = horaRegistro.split(':').map(Number);
          const esTarde = hReg > hLim || (hReg === hLim && mReg > mLim);

          if (esTarde) {
            notificarTardanza(est.cedula, hoy, horaRegistro, HORA_LIMITE_TARDANZA).catch(console.error);
          } else {
            notificarAsistencia(est.cedula, hoy, horaRegistro, nombreProfesor || 'El profesor', nombreClase).catch(console.error);
          }
        } else {
          notificarFaltaClase(est.cedula, hoy, nombreProfesor || 'El profesor', nombreClase, institucion_id).catch(console.error);
        }
      } catch (e) {
        console.error(`❌ notif ${est.cedula}:`, e.message);
      }
    }

    console.log(`✅ Clase finalizada: ${nombreClase} | Presentes: ${totalPresentes} | Ausentes: ${totalAusentes}`);

  } catch (error) {
    console.error('❌ finalizarClase:', error.message);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
};

// ========== SINCRONIZAR ASISTENCIA OFFLINE (BATCH) ==========
const sincronizarAsistenciaBatch = async (req, res) => {
  const { registros } = req.body;
  const institucion_id = req.user.institucion_id;

  if (!Array.isArray(registros) || registros.length === 0) {
    return res.json({ success: true, exitosos: [], duplicados: [], fallidos: [] });
  }

  const exitosos = [];
  const duplicados = [];
  const fallidos = [];

  for (const r of registros) {
    if (!r.id || !r.cedula || !r.materiaId || !r.fecha || !r.hora) {
      fallidos.push({ id: r.id, error: 'Registro incompleto' });
      continue;
    }
    try {
      const { error } = await supabase.from('asistencia').insert([{
        cedula: r.cedula, materia_id: r.materiaId, fecha: r.fecha, hora: r.hora,
        institucion_id, estado: 'presente',
      }]);
      if (error) {
        if (error.code === '23505') duplicados.push(r.id);
        else fallidos.push({ id: r.id, error: error.message });
        continue;
      }
      exitosos.push(r.id);
    } catch (e) {
      fallidos.push({ id: r.id, error: e.message });
    }
  }

  res.json({ success: true, exitosos, duplicados, fallidos });
};

const getRosterPorMateria = async (req, res) => {
  const { materiaId } = req.params;
  const institucion_id = req.user.institucion_id;
  if (!materiaId) return res.status(400).json({ error: 'Falta materiaId' });

  try {
    const { data: materia, error: errMateria } = await supabase
      .from('materias').select('grado, carrera').eq('id', materiaId).single();
    if (errMateria || !materia) return res.status(404).json({ error: 'Materia no encontrada' });

    let qEst = supabase.from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera, foto_url')
      .eq('grado', materia.grado);
    if (institucion_id) qEst = qEst.eq('institucion_id', institucion_id);
    const { data: todosEst, error: errEst } = await qEst;
    if (errEst) throw errEst;

    const carreraNorm = normalizarTexto(materia.carrera);
    const roster = (todosEst || []).filter(e => normalizarTexto(e.carrera) === carreraNorm);

    res.json(roster);
  } catch (error) {
    console.error('❌ getRosterPorMateria:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const eliminarAsistencia = async (req, res) => {
  const { id } = req.params;
  const institucion_id = req.user.institucion_id;
  const esAdmin = req.user.rol === 'admin';

  try {
    const { data: reg, error } = await supabase
      .from('asistencia')
      .select('id, cedula, fecha, estado, institucion_id, materias (profesor_id)')
      .eq('id', id)
      .single();
    if (error || !reg) return res.status(404).json({ error: 'El registro no existe o ya fue eliminado' });

    if (institucion_id && reg.institucion_id !== institucion_id) {
      return res.status(403).json({ error: 'Este registro pertenece a otra institución' });
    }
    if (reg.estado === 'excusado') {
      return res.status(400).json({ error: 'Este registro viene de una excusa aprobada y no se puede quitar desde aquí' });
    }
    if (!esAdmin) {
      if (reg.materias?.profesor_id !== req.user.id) {
        return res.status(403).json({ error: 'Solo puedes quitar asistencia de tus propias clases' });
      }
      if (reg.fecha !== fechaHondurasHoy()) {
        return res.status(403).json({ error: 'Solo se pueden quitar registros de hoy' });
      }
    }

    const { error: errDel } = await supabase.from('asistencia').delete().eq('id', id);
    if (errDel) return res.status(500).json({ error: 'No se pudo quitar el registro: ' + errDel.message });

    res.json({ success: true });
  } catch (e) {
    console.error('❌ eliminarAsistencia:', e.message);
    res.status(500).json({ error: e.message });
  }
};

// ... (El resto de tus funciones: exportarReporteExcel, getEstadisticas, etc. se mantienen exactamente igual) ...

module.exports = {
  registrarAsistencia, finalizarClase, sincronizarAsistenciaBatch,
  getAsistenciaHoy, getAsistenciaByFecha, getAsistenciaPorGrado,
  limpiarAsistenciaHoy, getReporteAsistencia, getRosterPorMateria,
  exportarReporteExcel, exportarReporteCompletoExcel, getReportesGenerados,
  getEstadisticas, exportarEstadisticasExcel, eliminarAsistencia
};
