const express=require('express');
const {requireAuth}=require('../middleware/auth');
const {requireCompany,requirePermission}=require('../middleware/company');
const TailorToolBoard=require('../models/TailorToolBoard');
const WorkspaceProject=require('../models/WorkspaceProject');
const {askTailorTools}=require('../lib/gemini');
const router=express.Router();
router.use(requireAuth,requireCompany);
const cid=req=>req.company._id, uid=req=>req.user.sub;

// Layers hold the photo underlay (a compressed data URL) and the block measurements.
const MAX_PHOTO_CHARS=4_000_000;
function checkLayers(layers){
  if(layers===undefined)return null;
  if(!Array.isArray(layers))return 'layers must be an array';
  if(layers.length>10)return 'Too many layers.';
  for(const l of layers){
    if(!l||typeof l!=='object')return 'Invalid layer.';
    if(l.type==='photo'){
      if(typeof l.src!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(l.src))return 'Photo must be a JPEG, PNG or WebP image.';
      if(l.src.length>MAX_PHOTO_CHARS)return 'That photo is too large. Try a smaller image.';
    }
  }
  return null;
}
const cleanNumber=(v,d,min,max)=>{const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):d};

router.get('/boards',async(req,res,next)=>{try{res.json({boards:await TailorToolBoard.find({companyId:cid(req)}).sort({updatedAt:-1}).limit(50)})}catch(e){next(e)}});
router.post('/boards',requirePermission('products:write'),async(req,res,next)=>{try{const b=await TailorToolBoard.create({companyId:cid(req),userId:uid(req),name:String(req.body.name||'Untitled Tailor Board').slice(0,120),projectId:req.body.projectId||null,unit:req.body.unit||'cm',width:cleanNumber(req.body.width,140,20,500),height:cleanNumber(req.body.height,180,20,500)});res.status(201).json({board:b})}catch(e){next(e)}});
router.get('/boards/:id',async(req,res,next)=>{try{const b=await TailorToolBoard.findOne({_id:req.params.id,companyId:cid(req)});if(!b)return res.status(404).json({error:'Board not found'});res.json({board:b})}catch(e){next(e)}});
router.put('/boards/:id',requirePermission('products:write'),async(req,res,next)=>{try{const allowed=['name','projectId','unit','width','height','operations','layers','notes','aiContext'];const patch={};for(const k of allowed)if(req.body[k]!==undefined)patch[k]=req.body[k];if(patch.width!==undefined)patch.width=cleanNumber(patch.width,140,20,500);if(patch.height!==undefined)patch.height=cleanNumber(patch.height,180,20,500);if(patch.operations!==undefined&&!Array.isArray(patch.operations))return res.status(400).json({error:'operations must be an array'});if(patch.operations!==undefined&&patch.operations.length>3000)return res.status(400).json({error:'Too many objects on one board (max 3000).'});const layerError=checkLayers(patch.layers);if(layerError)return res.status(400).json({error:layerError});const b=await TailorToolBoard.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:patch},{new:true,runValidators:true});if(!b)return res.status(404).json({error:'Board not found'});res.json({board:b})}catch(e){next(e)}});
router.delete('/boards/:id',requirePermission('products:write'),async(req,res,next)=>{try{const b=await TailorToolBoard.findOneAndDelete({_id:req.params.id,companyId:cid(req)});if(!b)return res.status(404).json({error:'Board not found'});res.json({ok:true})}catch(e){next(e)}});

router.post('/boards/:id/validate',async(req,res,next)=>{try{const b=await TailorToolBoard.findOne({_id:req.params.id,companyId:cid(req)});if(!b)return res.status(404).json({error:'Board not found'});const ops=Array.isArray(req.body.operations)?req.body.operations:b.operations;const errors=[],warnings=[];for(const [i,o] of ops.entries()){if(!o||typeof o!=='object'){errors.push(`Operation ${i+1} is invalid.`);continue}if(!o.type)errors.push(`Operation ${i+1} has no type.`);if(['line','seam','dart','notch','grainline','stitch'].includes(o.type)){for(const p of ['x1','y1','x2','y2'])if(o[p]!==undefined&&!Number.isFinite(Number(o[p])))errors.push(`Operation ${i+1}: ${p} must be numeric.`)}if(o.type==='piece'&&(!Array.isArray(o.points)||o.points.length<3||o.points.some(p=>!Array.isArray(p)||!Number.isFinite(Number(p[0]))||!Number.isFinite(Number(p[1])))))errors.push(`Operation ${i+1}: a pattern piece needs at least 3 numeric points.`);if(o.allowance!==undefined&&(!Number.isFinite(Number(o.allowance))||Number(o.allowance)<0))errors.push(`Operation ${i+1}: seam allowance cannot be negative.`)}const area=Math.max(0,Number(b.width))*Math.max(0,Number(b.height));if(area<400)warnings.push('Board is very small; check scale before export.');res.json({valid:errors.length===0,errors,warnings,operationCount:ops.length,unit:b.unit})}catch(e){next(e)}});

router.post('/ai',async(req,res,next)=>{try{const context={project:req.body.project||null,measurements:req.body.measurements||null,fabric:req.body.fabric||null,board:req.body.board||null,request:String(req.body.request||'').slice(0,3000)};const result=await askTailorTools(context);res.json(result)}catch(e){next(e)}});
router.post('/stitch-plan',async(req,res,next)=>{try{const context={project:req.body.project||null,measurements:req.body.measurements||null,operations:req.body.operations||[],request:String(req.body.request||'').slice(0,2000)};const result=await askTailorTools({...context,mode:'stitch-plan'});res.json(result)}catch(e){next(e)}});
router.post('/cutting-layout',async(req,res,next)=>{try{const context={project:req.body.project||null,measurements:req.body.measurements||null,fabric:req.body.fabric||null,operations:req.body.operations||[],request:String(req.body.request||'').slice(0,2000)};const result=await askTailorTools({...context,mode:'cutting-layout'});res.json(result)}catch(e){next(e)}});

// Board scale: 1 unit = 1 cm. The editor board is always 140 x 180 cm, so the export uses the same fixed page.
const BOARD_W=140,BOARD_H=180;
const escXml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const n2=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:0};
function offsetPoly(pts,d){
  const n=pts.length;let A=0;for(let i=0;i<n;i++){const [x1,y1]=pts[i],[x2,y2]=pts[(i+1)%n];A+=x1*y2-x2*y1}
  const s=A>=0?1:-1;
  const nrm=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return [s*dy/l,-s*dx/l]};
  return pts.map((p,i)=>{const n1=nrm(pts[(i-1+n)%n],p),n2_=nrm(p,pts[(i+1)%n]);const k=Math.max(.35,1+n1[0]*n2_[0]+n1[1]*n2_[1]);return [p[0]+d*(n1[0]+n2_[0])/k,p[1]+d*(n1[1]+n2_[1])/k]});
}
function shapeToSvg(o){
  const t=o.type;
  if(t==='piece'&&Array.isArray(o.points)&&o.points.length>=3){
    const pts=o.points.map(p=>[n2(p[0]),n2(p[1])]);
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
    const fmt=a=>a.map(p=>p.map(n2).join(',')).join(' ');
    let out=`<polygon points="${fmt(pts)}" fill="none" stroke="#111" stroke-width="0.6"/>`;
    const allow=o.allowance===undefined?1:Number(o.allowance);
    if(allow>0){let sa=offsetPoly(pts,allow);if(o.fold)sa=sa.map(([x,y])=>[Math.max(minX,x),y]);out+=`<polygon points="${fmt(sa)}" fill="none" stroke="#E66239" stroke-width="0.3" stroke-dasharray="1.6 1.2"/>`}
    if(o.fold)out+=`<line x1="${minX}" y1="${n2(minY+3)}" x2="${minX}" y2="${n2(minY+h-3)}" stroke="#111" stroke-width="0.4" marker-start="url(#a)" marker-end="url(#a)"/>`;
    const cx=n2(minX+w/2+(o.fold?1.5:0)),cy=n2(minY+h/2);
    const nm=String(o.name||'Piece'),fs=Math.min(3,Math.max(1.5,w/((nm.length*.62)||1))),tiny=h<14||w<14;
    out+=`<text x="${cx}" y="${n2(tiny?cy+fs*.35-(h<14?2.2:0):cy-1)}" font-size="${n2(fs)}" font-weight="700" text-anchor="middle" fill="#111">${escXml(nm)}</text>`;
    if(!tiny){out+=`<text x="${cx}" y="${n2(cy+2.6)}" font-size="2" text-anchor="middle" fill="#555">${escXml(`Cut ${o.cut||1}${o.fold?' | on fold':''}`)}</text><text x="${cx}" y="${n2(cy+5.2)}" font-size="2" text-anchor="middle" fill="#777">${escXml(`${n2(w)} x ${n2(h)} cm`)}</text>`}
    return out;
  }
  if(['line','seam','stitch','grainline','measure'].includes(t)){
    const a=[n2(o.x1),n2(o.y1)],b=[n2(o.x2),n2(o.y2)];
    if(t==='measure'){const len=Math.hypot(b[0]-a[0],b[1]-a[1]);return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#0E9AA7" stroke-width="0.4"/><text x="${n2((a[0]+b[0])/2)}" y="${n2((a[1]+b[1])/2-1)}" font-size="2.4" text-anchor="middle" fill="#0E9AA7">${n2(len)} cm</text>`}
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${t==='grainline'?'#555':'#111'}" stroke-width="${t==='stitch'?0.4:t==='grainline'?0.5:0.8}" ${t==='stitch'?'stroke-dasharray="2 1"':''} ${t==='grainline'?'marker-start="url(#a)" marker-end="url(#a)"':''}/>`;
  }
  if(t==='notch')return `<circle cx="${n2(o.x)}" cy="${n2(o.y)}" r="1.2" fill="#fff" stroke="#111" stroke-width="0.5"/>`;
  if(t==='dart'){const w=(Number(o.w)||3)/2,x=n2(o.x),y=n2(o.y),x2=n2(o.x2),y2=n2(o.y2);return `<path d="M${n2(x2-w)} ${y2}L${x} ${y}L${n2(x2+w)} ${y2}" fill="none" stroke="#111" stroke-width="0.5"/>`}
  if(t==='text'||t==='annotation')return `<text x="${n2(o.x)}" y="${n2(o.y)}" font-size="${Number(o.size)||3}" fill="#111">${escXml(o.text||'')}</text>`;
  return '';
}
router.get('/boards/:id/export.svg',async(req,res,next)=>{try{
  const b=await TailorToolBoard.findOne({_id:req.params.id,companyId:cid(req)});
  if(!b)return res.status(404).send('Board not found');
  const shapes=(b.operations||[]).map(o=>{try{return shapeToSvg(o)}catch{return ''}}).join('');
  const svg=`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_W}cm" height="${BOARD_H}cm" viewBox="0 0 ${BOARD_W} ${BOARD_H}"><defs><marker id="a" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" fill="#111"/></marker></defs><rect width="100%" height="100%" fill="white"/>${shapes}</svg>`;
  res.set('Content-Type','image/svg+xml');
  res.set('Content-Disposition',`attachment; filename="${String(b.name||'tailor-board').replace(/[^a-z0-9_-]+/gi,'-')}.svg"`);
  res.send(svg);
}catch(e){next(e)}});
module.exports=router;
