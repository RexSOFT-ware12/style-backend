const express=require('express');
const multer=require('multer');
const {requireAuth}=require('../middleware/auth');
const ApiSubscription=require('../models/ApiSubscription');
const BodyMeasurementScan=require('../models/BodyMeasurementScan');
const {getApiEntitlement}=require('../lib/apiEntitlement');
const {isOverAllowance}=require('../lib/apiCredits');
const {reportOverageUnit}=require('../lib/stripeMeters');
const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024,files:5}});
const VIEWS=['front','side','back','left','right'];
router.get('/scans',requireAuth,async(req,res,next)=>{try{const scans=await BodyMeasurementScan.find({userId:req.user.sub}).sort({createdAt:-1}).limit(30);res.json({scans});}catch(e){next(e)}});
router.post('/scans',requireAuth,upload.fields(VIEWS.map(name=>({name,maxCount:1}))),async(req,res,next)=>{
 let scan;
 try{
  const height=Number(req.body.height),unit=req.body.unit==='in'?'in':'cm';
  if(!Number.isFinite(height)||height<=0)return res.status(400).json({error:'Enter a valid height.'});
  const files=Object.fromEntries(VIEWS.map(k=>[k,req.files?.[k]?.[0]]).filter(x=>x[1]));
  if(!files.front||!files.side)return res.status(400).json({error:'Front and side photos are required.'});
  const count=Object.keys(files).length;
  const sub=await ApiSubscription.findOne({userId:req.user.sub});
  const entitlement=getApiEntitlement(sub);
  if(!entitlement.hasAccess)return res.status(402).json({error:'An active API Growth subscription is required for AI body measurement scans.',code:'API_SUBSCRIPTION_REQUIRED'});
  const worker=(process.env.BODY_MEASUREMENT_WORKER_URL||'').replace(/\/$/,'');
  if(!worker)return res.status(503).json({error:'The body-measurement engine is not connected yet. Configure BODY_MEASUREMENT_WORKER_URL to enable calibrated reconstruction.'});
  scan=await BodyMeasurementScan.create({userId:req.user.sub,companyId:req.company?._id,name:String(req.body.name||'').trim()||'Body scan',unit:'cm',height:unit==='in'?height*2.54:height,imageCount:count,status:'processing'});
  const form=new FormData();form.append('height',String(height));form.append('unit',unit);form.append('scan_id',scan.id);
  for(const [view,file] of Object.entries(files))form.append(view,new Blob([file.buffer],{type:file.mimetype}),file.originalname||`${view}.jpg`);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),240000);
  let response;
  try{response=await fetch(`${worker}/body-measurements/process`,{method:'POST',headers:{'x-fabric-internal-secret':process.env.FABRIC_NOW_INTERNAL_SECRET||''},body:form,signal:controller.signal});}
  finally{clearTimeout(timer)}
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(result.detail||result.error||'Body reconstruction failed.'),{status:response.status});
  if(!result.measurements||typeof result.measurements!=='object')throw new Error('The measurement engine returned no validated measurements.');
  // Count only after the worker has successfully returned a completed result.
  const updated=await ApiSubscription.findOneAndUpdate({_id:sub._id},{$inc:{'usage.segmentedCount':count}},{new:true});
  const usedAfter=(updated.usage.segmentedCount||0)+(updated.usage.bgOnlyCount||0);
  if(process.env.STRIPE_SECRET_KEY){const stripe=require('stripe')(process.env.STRIPE_SECRET_KEY);for(let i=0;i<count;i++){const usedBefore=usedAfter-count+i;if(isOverAllowance(updated,usedBefore))await reportOverageUnit(stripe,'segmented',updated.stripeCustomerId,`body-${scan.id}-${i+1}`).catch(e=>console.error('Body scan overage report failed:',e.message));}}
  scan.measurements=result.measurements;scan.confidence=result.confidence||{};scan.status=result.status==='review'?'review':'completed';scan.engineVersion=result.engine_version||'unknown';scan.outputs=result.outputs||{};await scan.save();
  res.json({scan,usage:{imagesDeducted:count,usedThisPeriod:usedAfter,quota:updated.quota,rolloverCredits:updated.rolloverCredits||0}});
 }catch(e){if(scan){scan.status='failed';await scan.save().catch(()=>{})}next(e)}
});

// Fetch a previously saved scan, including its calibrated 3D asset metadata.
router.get('/scans/:scanId',requireAuth,async(req,res,next)=>{try{const scan=await BodyMeasurementScan.findOne({_id:req.params.scanId,userId:req.user.sub});if(!scan)return res.status(404).json({error:'Scan not found.'});res.json({scan});}catch(e){next(e)}});


router.patch('/scans/:scanId/measurements',requireAuth,async(req,res,next)=>{
 try{
  const scan=await BodyMeasurementScan.findOne({_id:req.params.scanId,userId:req.user.sub});if(!scan)return res.status(404).json({error:'Scan not found.'});
  const edits=req.body?.measurements;if(!edits||typeof edits!=='object'||Array.isArray(edits))return res.status(400).json({error:'Provide a measurements object.'});
  const nextValues={...scan.measurements};
  for(const [key,raw] of Object.entries(edits)){
   if(!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key))return res.status(400).json({error:`Invalid measurement key: ${key}`});
   const value=Number(raw);if(!Number.isFinite(value)||value<=0||value>300)return res.status(400).json({error:`${key} must be between 0 and 300 cm.`});
   nextValues[key]={value:Math.round(value*10)/10,confidence:1,method:'manual_tape_verified_or_tailor_corrected',unit:'cm'};
  }
  scan.measurements=nextValues;scan.status='review';await scan.save();res.json({scan});
 }catch(e){next(e)}
});

// Draft a starting pattern from the reviewed measurement profile. One pattern generation
// consumes one image-equivalent API Growth unit, charged only after successful generation.
router.post('/scans/:scanId/patterns',requireAuth,async(req,res,next)=>{
 try{
  const scan=await BodyMeasurementScan.findOne({_id:req.params.scanId,userId:req.user.sub});
  if(!scan)return res.status(404).json({error:'Scan not found.'});
  if(!scan.measurements||!Object.keys(scan.measurements).length)return res.status(409).json({error:'This scan has no measurements to draft from.'});
  const sub=await ApiSubscription.findOne({userId:req.user.sub});const entitlement=getApiEntitlement(sub);
  if(!entitlement.hasAccess)return res.status(402).json({error:'An active API Growth subscription is required.',code:'API_SUBSCRIPTION_REQUIRED'});
  const worker=(process.env.BODY_MEASUREMENT_WORKER_URL||'').replace(/\/$/,'');
  if(!worker)return res.status(503).json({error:'Body-measurement worker is not configured.'});
  const response=await fetch(`${worker}/body-measurements/patterns`,{method:'POST',headers:{'content-type':'application/json','x-fabric-internal-secret':process.env.FABRIC_NOW_INTERNAL_SECRET||''},body:JSON.stringify({scan_id:String(scan._id),measurements:scan.measurements,unit:scan.unit,garment:req.body.garment||'bodice',ease_cm:req.body.ease_cm,seam_allowance_cm:req.body.seam_allowance_cm})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)return res.status(response.status).json({error:result.detail||result.error||'Pattern generation failed.'});
  const updated=await ApiSubscription.findOneAndUpdate({_id:sub._id},{$inc:{'usage.segmentedCount':1}},{new:true});
  const usedAfter=(updated.usage.segmentedCount||0)+(updated.usage.bgOnlyCount||0);
  if(process.env.STRIPE_SECRET_KEY){const stripe=require('stripe')(process.env.STRIPE_SECRET_KEY);const usedBefore=usedAfter-1;if(isOverAllowance(updated,usedBefore))await reportOverageUnit(stripe,'segmented',updated.stripeCustomerId,`body-pattern-${scan.id}-${Date.now()}`).catch(e=>console.error('Body pattern overage report failed:',e.message));}
  scan.patterns=scan.patterns||[];const workerPatternId=String(result.outputs?.svg_file||'').split('/').slice(-2,-1)[0];scan.patterns.push({garment:result.pattern?.garment||req.body.garment||'bodice',engineVersion:result.engine_version,workerPatternId,outputs:result.outputs,createdAt:new Date()});await scan.save();
  res.json({result,patternId:String(scan.patterns[scan.patterns.length-1]._id),usage:{imagesDeducted:1,usedThisPeriod:usedAfter,quota:updated.quota,rolloverCredits:updated.rolloverCredits||0}});
 }catch(e){next(e)}
});

// Proxy private worker files through the authenticated application API.
router.get('/scans/:scanId/files/:filename',requireAuth,async(req,res,next)=>{
 try{
  const scan=await BodyMeasurementScan.findOne({_id:req.params.scanId,userId:req.user.sub});if(!scan)return res.status(404).json({error:'Scan not found.'});
  const allowed=['body.glb','front-silhouette.png','side-silhouette.png'];if(!allowed.includes(req.params.filename))return res.status(404).end();
  const worker=(process.env.BODY_MEASUREMENT_WORKER_URL||'').replace(/\/$/,'');if(!worker)return res.status(503).json({error:'Worker not configured.'});
  const r=await fetch(`${worker}/body-measurements/files/${encodeURIComponent(String(scan._id))}/${encodeURIComponent(req.params.filename)}`,{headers:{'x-fabric-internal-secret':process.env.FABRIC_NOW_INTERNAL_SECRET||''}});
  if(!r.ok)return res.status(r.status).end();res.set('Content-Type',r.headers.get('content-type')||'application/octet-stream');res.set('Cache-Control','private, no-store');res.send(Buffer.from(await r.arrayBuffer()));
 }catch(e){next(e)}
});
router.get('/scans/:scanId/pattern-files/:patternId/:filename',requireAuth,async(req,res,next)=>{
 try{
  const scan=await BodyMeasurementScan.findOne({_id:req.params.scanId,userId:req.user.sub});if(!scan)return res.status(404).json({error:'Scan not found.'});
  if(!['pattern.svg','pattern.json'].includes(req.params.filename))return res.status(404).end();
  const pattern=(scan.patterns||[]).find(p=>String(p._id)===req.params.patternId);if(!pattern)return res.status(404).json({error:'Pattern not found.'});
  const worker=(process.env.BODY_MEASUREMENT_WORKER_URL||'').replace(/\/$/,'');
  const workerPath=pattern.outputs?.[req.params.filename==='pattern.svg'?'svg_file':'json_file'];if(!workerPath)return res.status(404).end();
  const workerPatternId=pattern.workerPatternId;if(!workerPatternId)return res.status(404).end();
  const r=await fetch(`${worker}${workerPath}`,{headers:{'x-fabric-internal-secret':process.env.FABRIC_NOW_INTERNAL_SECRET||''}});if(!r.ok)return res.status(r.status).end();
  res.set('Content-Type',r.headers.get('content-type')||'application/octet-stream');res.set('Cache-Control','private, no-store');res.send(Buffer.from(await r.arrayBuffer()));
 }catch(e){next(e)}
});

module.exports=router;
