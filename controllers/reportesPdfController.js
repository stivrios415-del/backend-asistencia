const { supabase } = require('../config/supabase');
const PDFDocument  = require('pdfkit');
const axios        = require('axios');

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

async function obtenerInstitucion(institucion_id) {
  if (!institucion_id) return { nombre: 'Sistema de Asistencia', color_primario: '#143C65', color_secundario: '#256D5B', logo_url: null };
  const { data } = await supabase.from('instituciones')
    .select('nombre, color_primario, color_secundario, logo_url').eq('id', institucion_id).single();
  return data || { nombre: 'Sistema de Asistencia', color_primario: '#143C65', color_secundario: '#256D5B', logo_url: null };
}

async function descargarImagen(url) {
  if (!url) return null;
  try {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
    return Buffer.from(r.data);
  } catch (e) { console.warn('⚠️ Logo no descargado:', e.message); return null; }
}

async function subirYRetornarUrl(buffer, fileName) {
  const { error } = await supabase.storage.from('reportes').upload(fileName, buffer, {
    contentType: 'application/pdf', upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from('reportes').getPublicUrl(fileName);
  return data.publicUrl;
}

function fmtFecha(str) {
  return new Date(str + 'T12:00:00').toLocaleDateString('es-HN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Tegucigalpa'
  });
}

// ── Dibujar encabezado ────────────────────────────────────────────────────────
function encabezado(doc, inst, logo, generadoPor, subtitulo) {
  const [r,g,b]   = hexToRgb(inst.color_primario);
  const [r2,g2,b2]= hexToRgb(inst.color_secundario);
  const W = doc.page.width;

  doc.rect(0, 0, W, 108).fill([r,g,b]);

  let xT = 20;
  if (logo) {
    try { doc.image(logo, 18, 12, { width: 78, height: 78 }); xT = 110; } catch(_) {}
  }

  doc.fillColor('#FFFFFF')
     .font('Helvetica-Bold').fontSize(17)
     .text(inst.nombre.toUpperCase(), xT, 18, { width: W - xT - 20 });
  doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,0.85)')
     .text('REPORTE OFICIAL DE ASISTENCIA', xT, 44);
  doc.fontSize(9).fillColor('rgba(255,255,255,0.75)')
     .text(subtitulo, xT, 61);
  if (generadoPor)
    doc.fontSize(8).fillColor('rgba(255,255,255,0.65)')
       .text(`Generado por: ${generadoPor}  •  ${new Date().toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'})}`, xT, 78);

  doc.rect(0, 108, W, 5).fill([r2,g2,b2]);
  return 124;
}

// ── Dibujar pie ───────────────────────────────────────────────────────────────
function pie(doc, inst, pag, total) {
  const [r,g,b] = hexToRgb(inst.color_primario);
  const W = doc.page.width;
  const H = doc.page.height;

  // Líneas de firma
  doc.rect(30, H-55, 180, 0.5).fill('#AAAAAA');
  doc.rect(W-210, H-55, 180, 0.5).fill('#AAAAAA');
  doc.fillColor('#666666').font('Helvetica').fontSize(7.5)
     .text('Firma del Director / Coordinador', 30, H-47)
     .text('Firma del Profesor', W-210, H-47);

  // Banda
  doc.rect(0, H-30, W, 30).fill([r,g,b]);
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(7.5)
     .text(`${inst.nombre}  •  Documento oficial generado por KAIROS ASSIST`, 20, H-20, { width: W-160 })
     .text(`Pág. ${pag} / ${total}`, W-150, H-20, { width: 130, align: 'right' });
}

// ── Tabla encabezado helper ───────────────────────────────────────────────────
function headerTabla(doc, cols, y, color) {
  const W = doc.page.width; const M = 30;
  doc.rect(M, y, W-M*2, 15).fill(color);
  let x = M+4;
  cols.forEach(c => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF')
       .text(c.label, x, y+4, { width: c.w-3 });
    x += c.w;
  });
  return y+15;
}

// ── Obtener materias del profesor ─────────────────────────────────────────────
async function getMateriaIds(profesorEmail, institucion_id) {
  if (!profesorEmail || profesorEmail === 'all') return null;
  let { data: prof } = await supabase.from('profesores').select('id').eq('email', profesorEmail.trim()).single();
  if (!prof) { const { data: p2 } = await supabase.from('profesores').select('id').eq('email', profesorEmail.trim().toLowerCase()).single(); prof = p2; }
  if (!prof) return [];
  let q = supabase.from('materias').select('id').eq('profesor_id', prof.id);
  if (institucion_id) q = q.eq('institucion_id', institucion_id);
  const { data } = await q;
  return data ? data.map(m => m.id) : [];
}

// ════════════════════════════════════════════════════════════════════════════
// ENDPOINT 1: PDF por fecha exacta (detalle por clase)
// GET /api/reportes-pdf/diario?fecha=YYYY-MM-DD&profesorEmail=...&nombreProfesor=...
// ════════════════════════════════════════════════════════════════════════════
const exportarReportePDF = async (req, res) => {
  const { fecha, profesorEmail, nombreProfesor, grado, seccion } = req.query;
  const institucion_id = req.user.institucion_id;
  if (!fecha) return res.status(400).json({ error: 'Falta parámetro fecha' });

  try {
    const inst = await obtenerInstitucion(institucion_id);
    const logo = await descargarImagen(inst.logo_url);
    const [rP,gP,bP] = hexToRgb(inst.color_primario);
    const [rS,gS,bS] = hexToRgb(inst.color_secundario);
    const W = 595, M = 30;

    // Obtener datos
    let q = supabase.from('asistencia').select(`
      cedula, hora, materia_id, estado,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera),
      materias (id, grado, seccion, carrera, nombre, profesor_id,
        profesores:profesor_id (nombre))
    `).eq('fecha', fecha);
    if (institucion_id) q = q.eq('institucion_id', institucion_id);
    const ids = await getMateriaIds(profesorEmail, institucion_id);
    if (ids !== null) {
      if (ids.length === 0) return res.json({ success: true, url: null, mensaje: 'Sin asistencias' });
      q = q.in('materia_id', ids);
    }
    if (grado)   q = q.filter('materias.grado', 'eq', grado);
    if (seccion) q = q.filter('materias.seccion', 'eq', seccion);
    const { data: asistencias, error } = await q;
    if (error) throw error;

    // Agrupar por materia
    const grupos = new Map();
    asistencias.forEach(a => {
      const mat = a.materias; if (!mat) return;
      if (!grupos.has(mat.id)) grupos.set(mat.id, { mat, alumnos: [] });
      grupos.get(mat.id).alumnos.push({ est: a.estudiantes, hora: a.hora, estado: a.estado||'presente' });
    });

    // Crear PDF
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = []; doc.on('data', c => chunks.push(c));
    let y = encabezado(doc, inst, logo, nombreProfesor || profesorEmail, fmtFecha(fecha));
    let pag = 1;

    // Resumen cajas
    const totPres = asistencias.filter(a=>a.estado!=='excusado').length;
    const totExc  = asistencias.filter(a=>a.estado==='excusado').length;
    const cajas = [
      { label:'Presentes', val:totPres, color:[rS,gS,bS] },
      { label:'Excusados', val:totExc,  color:[14,165,233] },
      { label:'Clases',    val:grupos.size, color:[rP,gP,bP] },
    ];
    const wC = (W-M*2-20)/3;
    cajas.forEach((c,i)=>{
      const x = M+i*(wC+10);
      doc.roundedRect(x,y,wC,48,6).fill(c.color);
      doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(24).text(String(c.val),x,y+5,{width:wC,align:'center'});
      doc.font('Helvetica').fontSize(8).text(c.label,x,y+33,{width:wC,align:'center'});
    });
    y+=62;

    // Tabla resumen por clase
    doc.font('Helvetica-Bold').fontSize(11).fillColor([rP,gP,bP]).text('RESUMEN POR CLASE',M,y); y+=14;
    const colsRes=[{label:'Clase/Materia',w:180},{label:'Profesor',w:130},{label:'Grado',w:55},{label:'Presentes',w:65},{label:'Excusados',w:65},{label:'Total',w:50}];
    y = headerTabla(doc, colsRes, y, [rP,gP,bP]);
    Array.from(grupos.values()).sort((a,b)=>String(a.mat.grado).localeCompare(String(b.mat.grado))).forEach((g,i)=>{
      const pres=g.alumnos.filter(a=>a.estado!=='excusado').length;
      const exc=g.alumnos.filter(a=>a.estado==='excusado').length;
      doc.rect(M,y,W-M*2,14).fill(i%2===0?[245,248,252]:[255,255,255]);
      let x=M+4;
      [{v:g.mat.nombre||g.mat.carrera,bold:true},{v:g.mat.profesores?.nombre||'—'},{v:`${g.mat.grado}°${g.mat.seccion}`},{v:String(pres),color:[rS,gS,bS],bold:true},{v:String(exc),color:[14,165,233],bold:true},{v:String(pres+exc)}].forEach((val,ci)=>{
        doc.font(val.bold?'Helvetica-Bold':'Helvetica').fontSize(8).fillColor(val.color||[30,30,30])
           .text(val.v,x,y+3,{width:colsRes[ci].w-4});
        x+=colsRes[ci].w;
      });
      y+=14;
    });
    // Fila totales
    doc.rect(M,y,W-M*2,16).fill([rP,gP,bP]);
    let x=M+4;
    [{v:''},{v:''},{v:'TOTALES'},{v:String(totPres),bold:true},{v:String(totExc),bold:true},{v:String(totPres+totExc),bold:true}].forEach((val,ci)=>{
      doc.font(val.bold?'Helvetica-Bold':'Helvetica').fontSize(8).fillColor('#FFF').text(val.v,x,y+4,{width:colsRes[ci].w-4});
      x+=colsRes[ci].w;
    });
    y+=22;

    // Detalle por clase
    const colsEst=[{label:'#',w:22},{label:'Cédula',w:93},{label:'Nombre',w:138},{label:'Apellido',w:138},{label:'Hora',w:53},{label:'Estado',w:90}];
    for(const grupo of Array.from(grupos.values()).sort((a,b)=>String(a.mat.grado).localeCompare(String(b.mat.grado)))){
      const pres=grupo.alumnos.filter(a=>a.estado!=='excusado').length;
      const exc=grupo.alumnos.filter(a=>a.estado==='excusado').length;
      // Nueva página si no cabe
      if(y>doc.page.height-100){
        pie(doc,inst,pag,'?'); doc.addPage(); pag++;
        y=encabezado(doc,inst,logo,nombreProfesor||profesorEmail,fmtFecha(fecha));
      }
      // Encabezado clase
      doc.rect(M,y,W-M*2,20).fill([rS,gS,bS]);
      doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(10)
         .text(`${grupo.mat.nombre||grupo.mat.carrera} — ${grupo.mat.grado}° Sección ${grupo.mat.seccion}`,M+8,y+5,{width:W-M*2-16});
      y+=20;
      doc.rect(M,y,W-M*2,13).fill([240,245,255]);
      doc.font('Helvetica').fontSize(8).fillColor([70,70,70])
         .text(`Profesor: ${grupo.mat.profesores?.nombre||'—'}   |   Presentes: ${pres}   |   Excusados: ${exc}`,M+8,y+3);
      y+=13;
      y=headerTabla(doc,colsEst,y,[rP,gP,bP]);

      grupo.alumnos.sort((a,b)=>{
        const na=`${a.est?.apellido} ${a.est?.nombre}`;
        const nb=`${b.est?.apellido} ${b.est?.nombre}`;
        return na.localeCompare(nb);
      }).forEach((item,i)=>{
        if(y>doc.page.height-80){ pie(doc,inst,pag,'?'); doc.addPage(); pag++; y=encabezado(doc,inst,logo,nombreProfesor||profesorEmail,fmtFecha(fecha)); y=headerTabla(doc,colsEst,y,[rP,gP,bP]); }
        const esExc=item.estado==='excusado';
        doc.rect(M,y,W-M*2,13).fill(esExc?[224,242,254]:i%2===0?[250,252,255]:[255,255,255]);
        let xc=M+4;
        [{v:String(i+1)},{v:item.est?.cedula||'—'},{v:item.est?.nombre||'—'},{v:item.est?.apellido||'—'},{v:esExc?'—':(item.hora?.substring(0,5)||'—')},{v:esExc?'EXCUSADO':'PRESENTE',bold:true,color:esExc?[14,165,233]:[rS,gS,bS]}].forEach((val,ci)=>{
          doc.font(val.bold?'Helvetica-Bold':'Helvetica').fontSize(7.5).fillColor(val.color||[30,30,30])
             .text(val.v,xc,y+3,{width:colsEst[ci].w-3});
          xc+=colsEst[ci].w;
        });
        doc.rect(M,y+13,W-M*2,0.3).fill([215,215,215]);
        y+=13;
      });
      y+=10;
    }

    // Pie en todas las páginas
    const totPags=doc.bufferedPageRange().count;
    for(let i=0;i<totPags;i++){
      doc.switchToPage(i);
      pie(doc,inst,i+1,totPags);
    }
    doc.flushPages(); doc.end();
    await new Promise(r=>doc.on('end',r));
    const pdf=Buffer.concat(chunks);
    const url=await subirYRetornarUrl(pdf,`reportes_pdf/diario_${fecha}_${Date.now()}.pdf`);
    return res.json({success:true,url});
  } catch(e){ console.error('❌ PDF diario:',e.message); return res.status(500).json({error:e.message}); }
};

// ════════════════════════════════════════════════════════════════════════════
// ENDPOINT 2: PDF por rango de fechas (lista cronológica)
// GET /api/reportes-pdf/rango?fechaInicio=...&fechaFin=...&profesorEmail=...
// ════════════════════════════════════════════════════════════════════════════
const exportarReportePDFRango = async (req, res) => {
  const { fechaInicio, fechaFin, profesorEmail, nombreProfesor } = req.query;
  const institucion_id = req.user.institucion_id;
  if (!fechaInicio||!fechaFin) return res.status(400).json({error:'Falta fechaInicio o fechaFin'});

  try {
    const inst = await obtenerInstitucion(institucion_id);
    const logo = await descargarImagen(inst.logo_url);
    const [rP,gP,bP] = hexToRgb(inst.color_primario);
    const [rS,gS,bS] = hexToRgb(inst.color_secundario);
    const W=595, M=30;

    let q = supabase.from('asistencia').select(`
      cedula, fecha, hora, estado,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera),
      materias (id, nombre, grado, seccion, profesor_id, profesores:profesor_id(nombre))
    `).gte('fecha',fechaInicio).lte('fecha',fechaFin).order('fecha',{ascending:true});
    if (institucion_id) q=q.eq('institucion_id',institucion_id);
    const ids=await getMateriaIds(profesorEmail,institucion_id);
    if(ids!==null){
      if(ids.length===0) return res.json({success:true,url:null,mensaje:'Sin asistencias'});
      q=q.in('materia_id',ids);
    }
    const {data:asistencias,error}=await q;
    if(error) throw error;

    const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true});
    const chunks=[]; doc.on('data',c=>chunks.push(c));
    let pag=1;

    // Encabezado
    let y=encabezado(doc,inst,logo,nombreProfesor||profesorEmail,`Período: ${fechaInicio} al ${fechaFin}`);

    // Resumen cajas
    const totPres=asistencias.filter(a=>a.estado!=='excusado').length;
    const totExc=asistencias.filter(a=>a.estado==='excusado').length;
    const dias=[...new Set(asistencias.map(a=>a.fecha))].length;
    const cajas=[
      {label:'Total registros',val:asistencias.length,color:[rP,gP,bP]},
      {label:'Presentes',val:totPres,color:[rS,gS,bS]},
      {label:'Excusados',val:totExc,color:[14,165,233]},
      {label:'Días',val:dias,color:[100,100,100]},
    ];
    const wC=(W-M*2-15)/4;
    cajas.forEach((c,i)=>{
      const x=M+i*(wC+5);
      doc.roundedRect(x,y,wC,44,5).fill(c.color);
      doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(20).text(String(c.val),x,y+5,{width:wC,align:'center'});
      doc.font('Helvetica').fontSize(7).text(c.label,x,y+28,{width:wC,align:'center'});
    });
    y+=57;

    // Tabla
    doc.font('Helvetica-Bold').fontSize(11).fillColor([rP,gP,bP]).text('DETALLE DE REGISTROS',M,y); y+=14;
    const cols=[{label:'Fecha',w:68},{label:'Hora',w:43},{label:'Cédula',w:88},{label:'Nombre',w:108},{label:'Apellido',w:108},{label:'Grado',w:45},{label:'Estado',w:75}];
    y=headerTabla(doc,cols,y,[rP,gP,bP]);

    asistencias.forEach((item,i)=>{
      if(y>doc.page.height-80){
        const tot=doc.bufferedPageRange().count;
        pie(doc,inst,pag,tot+1); doc.addPage(); pag++;
        y=headerTabla(doc,cols,30,[rP,gP,bP]);
      }
      const esExc=item.estado==='excusado';
      const est=item.estudiantes;
      doc.rect(M,y,W-M*2,13).fill(esExc?[224,242,254]:i%2===0?[248,250,255]:[255,255,255]);
      let x=M+4;
      [{v:item.fecha},{v:esExc?'—':(item.hora?.substring(0,5)||'—')},{v:est?.cedula||'—'},{v:est?.nombre||'—'},{v:est?.apellido||'—'},{v:`${est?.grado}° ${est?.seccion}`},{v:esExc?'EXCUSADO':'PRESENTE',bold:true,color:esExc?[14,165,233]:[rS,gS,bS]}].forEach((val,ci)=>{
        doc.font(val.bold?'Helvetica-Bold':'Helvetica').fontSize(7.5).fillColor(val.color||[30,30,30])
           .text(val.v,x,y+3,{width:cols[ci].w-3});
        x+=cols[ci].w;
      });
      doc.rect(M,y+13,W-M*2,0.3).fill([210,210,210]);
      y+=13;
    });

    // Pie en todas
    const totPags=doc.bufferedPageRange().count;
    for(let i=0;i<totPags;i++){
      doc.switchToPage(i);
      pie(doc,inst,i+1,totPags);
    }
    doc.flushPages(); doc.end();
    await new Promise(r=>doc.on('end',r));
    const pdf=Buffer.concat(chunks);
    const url=await subirYRetornarUrl(pdf,`reportes_pdf/rango_${fechaInicio}_${fechaFin}_${Date.now()}.pdf`);
    return res.json({success:true,url});
  } catch(e){ console.error('❌ PDF rango:',e.message); return res.status(500).json({error:e.message}); }
};

module.exports = { exportarReportePDF, exportarReportePDFRango };