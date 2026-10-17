const express=require('express');
const {requireAuth}=require('../middleware/auth');
const {requireCompany,requirePermission}=require('../middleware/company');
const WorkspaceProject=require('../models/WorkspaceProject');
const WorkspaceCollection=require('../models/WorkspaceCollection');
const WorkspaceAsset=require('../models/WorkspaceAsset');
const Fabric=require('../models/Fabric');
const MeasurementProfile=require('../models/MeasurementProfile');
const TechPack=require('../models/TechPack');
const ProductionItem=require('../models/ProductionItem');
const QualityAudit=require('../models/QualityAudit');
const {upload}=require('../middleware/upload');
const {createRateLimiter}=require('../middleware/rateLimit');
const {askFabricFromImage,makeFabricSwatch}=require('../lib/patternDesign');
const fabricAiLimit=createRateLimiter({windowMs:60000,max:12,message:'You are analysing fabrics quickly. Please wait a minute and try again.'});
const router=express.Router();
router.use(requireAuth,requireCompany);
const uid=req=>req.user.sub;
const cid=req=>req.company._id;
const limit=(v,max=500)=>Math.min(Number(v)||100,max);

router.get('/dashboard',async(req,res,next)=>{try{
  const [projects,collections,all,team]=await Promise.all([
    WorkspaceProject.find({companyId:cid(req)}).sort({updatedAt:-1}).limit(12),
    WorkspaceCollection.find({companyId:cid(req)}).sort({updatedAt:-1}).limit(8),
    WorkspaceProject.find({companyId:cid(req)}).select('status readiness'),
    WorkspaceAsset.countDocuments({companyId:cid(req)})
  ]);
  res.json({metrics:{products:all.length,processing:all.filter(x=>x.status==='processing').length,review:all.filter(x=>x.status==='review').length,approved:all.filter(x=>x.status==='approved').length,readiness:all.length?Math.round(all.reduce((s,x)=>s+(x.readiness||0),0)/all.length):0,assets:team},projects,collections,company:req.company,membership:req.membership});
}catch(e){next(e)}});

router.get('/projects',async(req,res,next)=>{try{const q={companyId:cid(req)};if(req.query.status)q.status=req.query.status;res.json({projects:await WorkspaceProject.find(q).sort({updatedAt:-1}).limit(limit(req.query.limit))})}catch(e){next(e)}});
router.post('/projects',requirePermission('products:write'),async(req,res,next)=>{try{const p=await WorkspaceProject.create({...req.body,userId:uid(req),companyId:cid(req)});res.status(201).json({project:p})}catch(e){next(e)}});
router.post('/projects/:id/source-images',requirePermission('products:write'),upload.array('images',6),async(req,res,next)=>{try{
  const p=await WorkspaceProject.findOne({_id:req.params.id,companyId:cid(req)});if(!p)return res.status(404).json({error:'Project not found'});if(!req.files?.length)return res.status(400).json({error:'Add at least one image.'});
  const assets=await WorkspaceAsset.insertMany(req.files.map(f=>({userId:uid(req),companyId:cid(req),projectId:p._id,name:f.originalname,type:'image',url:`/uploads/${f.filename}`,mime:f.mimetype,size:f.size,status:'ready',tags:['source','garment']})));
  const urls=assets.map(a=>a.url);p.sourceImages=[...(p.sourceImages||[]),...urls];p.assets=[...(p.assets||[]),...assets.map(a=>({name:a.name,type:a.type,url:a.url,mime:a.mime,size:a.size,status:'approved',tags:a.tags,metadata:{assetId:a.id}}))];await p.save();res.status(201).json({project:p,assets});
}catch(e){next(e)}});
router.get('/projects/:id',async(req,res,next)=>{try{const p=await WorkspaceProject.findOne({_id:req.params.id,companyId:cid(req)});if(!p)return res.status(404).json({error:'Project not found'});res.json({project:p})}catch(e){next(e)}});
router.put('/projects/:id',requirePermission('products:write'),async(req,res,next)=>{try{const allowed=['name','sku','category','brand','fabric','color','style','status','sourceImages','extractedParts','fabricAssets','patternAssets','mockupAssets','technicalFlat','measurements','bom','listing','seo','readiness','reviewNotes','tasks','assets','collectionId','meta'];const patch={};for(const k of allowed)if(req.body[k]!==undefined)patch[k]=req.body[k];const p=await WorkspaceProject.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{...patch,$inc:{version:1}},{new:true});if(!p)return res.status(404).json({error:'Project not found'});res.json({project:p})}catch(e){next(e)}});
router.delete('/projects/:id',requirePermission('products:write'),async(req,res,next)=>{try{const p=await WorkspaceProject.findOneAndDelete({_id:req.params.id,companyId:cid(req)});if(!p)return res.status(404).json({error:'Project not found'});res.json({ok:true})}catch(e){next(e)}});
router.post('/projects/:id/readiness',requirePermission('products:write'),async(req,res,next)=>{try{const p=await WorkspaceProject.findOne({_id:req.params.id,companyId:cid(req)});if(!p)return res.status(404).json({error:'Project not found'});const checks=[['name',!!p.name],['category',!!p.category],['fabric',!!p.fabric],['sourceImages',p.sourceImages?.length>0],['listing',!!p.listing?.description],['technicalFlat',!!p.technicalFlat?.front],['measurements',Object.keys(p.measurements||{}).length>0],['bom',p.bom?.length>0]];const readiness=Math.round(checks.filter(x=>x[1]).length/checks.length*100);p.readiness=readiness;await p.save();res.json({readiness,checks:checks.map(([name,ok])=>({name,ok}))})}catch(e){next(e)}});

router.get('/collections',async(req,res,next)=>{try{res.json({collections:await WorkspaceCollection.find({companyId:cid(req)}).sort({updatedAt:-1})})}catch(e){next(e)}});
router.post('/collections',requirePermission('collections:write'),async(req,res,next)=>{try{res.status(201).json({collection:await WorkspaceCollection.create({...req.body,userId:uid(req),companyId:cid(req)})})}catch(e){next(e)}});
router.put('/collections/:id',requirePermission('collections:write'),async(req,res,next)=>{try{const c=await WorkspaceCollection.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:req.body},{new:true});if(!c)return res.status(404).json({error:'Collection not found'});res.json({collection:c})}catch(e){next(e)}});
router.post('/collections/:id/generate',requirePermission('collections:write'),async(req,res,next)=>{try{const c=await WorkspaceCollection.findOne({_id:req.params.id,companyId:cid(req)});if(!c)return res.status(404).json({error:'Collection not found'});const products=await WorkspaceProject.find({_id:{$in:c.productIds},companyId:cid(req)});c.lookbook={title:`${c.name} Lookbook`,pages:products.map(p=>({projectId:p.id,title:p.name,image:p.mockupAssets?.[0]||p.sourceImages?.[0],description:p.listing?.description||''}))};c.catalogue={title:c.name,items:products.map(p=>({sku:p.sku,name:p.name,category:p.category,fabric:p.fabric,color:p.color}))};await c.save();res.json({collection:c,products})}catch(e){next(e)}});

router.get('/team',async(req,res,next)=>{try{res.json({company:req.company,membership:req.membership})}catch(e){next(e)}});
router.put('/team',requirePermission('company:manage'),async(req,res,next)=>{try{const patch={};if(req.body.name)patch.name=String(req.body.name).trim();if(req.body.brandKit)patch.brandKit=req.body.brandKit;if(req.body.settings)patch.settings=req.body.settings;const c=await require('../models/Company').findByIdAndUpdate(cid(req),{$set:patch},{new:true});res.json({company:c})}catch(e){next(e)}});

router.get('/library',async(req,res,next)=>{try{const q={companyId:cid(req)};if(req.query.projectId)q.projectId=req.query.projectId;if(req.query.type)q.type=req.query.type;res.json({assets:await WorkspaceAsset.find(q).sort({updatedAt:-1}).limit(limit(req.query.limit,500))})}catch(e){next(e)}});
router.post('/library/assets',requirePermission('assets:write'),async(req,res,next)=>{try{const {name,url}=req.body||{};if(!name||!url)return res.status(400).json({error:'Asset name and URL are required.'});res.status(201).json({asset:await WorkspaceAsset.create({...req.body,userId:uid(req),companyId:cid(req)})})}catch(e){next(e)}});
router.put('/library/assets/:id',requirePermission('assets:write'),async(req,res,next)=>{try{const allowed=['projectId','name','type','url','mime','size','status','tags','metadata'];const patch={};for(const k of allowed)if(req.body[k]!==undefined)patch[k]=req.body[k];const asset=await WorkspaceAsset.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:patch},{new:true,runValidators:true});if(!asset)return res.status(404).json({error:'Asset not found'});res.json({asset})}catch(e){next(e)}});
router.delete('/library/assets/:id',requirePermission('assets:write'),async(req,res,next)=>{try{const asset=await WorkspaceAsset.findOneAndDelete({_id:req.params.id,companyId:cid(req)});if(!asset)return res.status(404).json({error:'Asset not found'});res.json({ok:true})}catch(e){next(e)}});

// Fabric Library
router.get('/fabrics',async(req,res,next)=>{try{res.json({fabrics:await Fabric.find({companyId:cid(req),...(req.query.status?{status:req.query.status}:{})}).sort({updatedAt:-1}).limit(limit(req.query.limit))})}catch(e){next(e)}});
const FABRIC_FIELDS=['name','supplier','code','composition','weightGsm','widthCm','color','pattern','origin','notes','imageUrl','meta','status'];
// Only known fields are accepted. imageUrl may be a small data URL (a swatch made from a photo) or an http(s) link.
function fabricBody(b={}){const o={};for(const k of FABRIC_FIELDS)if(b[k]!==undefined)o[k]=b[k];if(o.imageUrl!==undefined&&o.imageUrl!==''&&!((/^data:image\/(jpeg|png|webp);base64,/.test(o.imageUrl)&&o.imageUrl.length<=900000)||/^https?:\/\/[^\s"'<>`\\]+$/.test(o.imageUrl)))delete o.imageUrl;if(o.meta&&JSON.stringify(o.meta).length>4000)delete o.meta;if(o.status&&!['active','archived'].includes(o.status))delete o.status;return o}
router.post('/fabrics',requirePermission('fabrics:write'),async(req,res,next)=>{try{res.status(201).json({fabric:await Fabric.create({...fabricBody(req.body),companyId:cid(req)})})}catch(e){next(e)}});
router.put('/fabrics/:id',requirePermission('fabrics:write'),async(req,res,next)=>{try{const f=await Fabric.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:fabricBody(req.body)},{new:true,runValidators:true});if(!f)return res.status(404).json({error:'Fabric not found'});res.json({fabric:f})}catch(e){next(e)}});
router.delete('/fabrics/:id',requirePermission('fabrics:write'),async(req,res,next)=>{try{const f=await Fabric.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:{status:'archived'}},{new:true});if(!f)return res.status(404).json({error:'Fabric not found'});res.json({fabric:f})}catch(e){next(e)}});
// AI: read a fabric photo and suggest a library record, or redraw it as a clean swatch
router.post('/fabrics/ai-analyze',requirePermission('fabrics:write'),fabricAiLimit,async(req,res,next)=>{try{const out=await askFabricFromImage(req.body?.imageDataUrl,req.body?.hint);res.json({fabric:out})}catch(e){if(e.publicMessage)return res.status(e.status||500).json({error:e.publicMessage});next(e)}});
router.post('/fabrics/ai-swatch',requirePermission('fabrics:write'),fabricAiLimit,async(req,res,next)=>{try{res.json(await makeFabricSwatch(req.body?.imageDataUrl))}catch(e){if(e.publicMessage)return res.status(e.status||500).json({error:e.publicMessage});next(e)}});

// Measurements & Size Profiles
router.get('/measurements',async(req,res,next)=>{try{res.json({profiles:await MeasurementProfile.find({companyId:cid(req)}).sort({updatedAt:-1})})}catch(e){next(e)}});
router.post('/measurements',requirePermission('measurements:write'),async(req,res,next)=>{try{res.status(201).json({profile:await MeasurementProfile.create({...req.body,companyId:cid(req)})})}catch(e){next(e)}});
router.put('/measurements/:id',requirePermission('measurements:write'),async(req,res,next)=>{try{const p=await MeasurementProfile.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:req.body},{new:true,runValidators:true});if(!p)return res.status(404).json({error:'Size profile not found'});res.json({profile:p})}catch(e){next(e)}});
router.delete('/measurements/:id',requirePermission('measurements:write'),async(req,res,next)=>{try{const p=await MeasurementProfile.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:{status:'archived'}},{new:true});if(!p)return res.status(404).json({error:'Size profile not found'});res.json({profile:p})}catch(e){next(e)}});

// Tech packs
router.get('/tech-packs',async(req,res,next)=>{try{res.json({techPacks:await TechPack.find({companyId:cid(req)}).sort({updatedAt:-1})})}catch(e){next(e)}});
router.post('/tech-packs',requirePermission('techpacks:write'),async(req,res,next)=>{try{res.status(201).json({techPack:await TechPack.create({...req.body,companyId:cid(req)})})}catch(e){next(e)}});
router.put('/tech-packs/:id',requirePermission('techpacks:write'),async(req,res,next)=>{try{const t=await TechPack.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:req.body,$inc:{version:1}},{new:true,runValidators:true});if(!t)return res.status(404).json({error:'Tech pack not found'});res.json({techPack:t})}catch(e){next(e)}});
router.post('/tech-packs/:id/approve',requirePermission('techpacks:write'),async(req,res,next)=>{try{const t=await TechPack.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:{status:'approved',approvedBy:uid(req),approvedAt:new Date()}},{new:true});if(!t)return res.status(404).json({error:'Tech pack not found'});res.json({techPack:t})}catch(e){next(e)}});

// Production Board
router.get('/production',async(req,res,next)=>{try{const q={companyId:cid(req)};if(req.query.stage)q.stage=req.query.stage;res.json({items:await ProductionItem.find(q).populate('assigneeId','name email').sort({updatedAt:-1})})}catch(e){next(e)}});
router.post('/production',requirePermission('production:write'),async(req,res,next)=>{try{res.status(201).json({item:await ProductionItem.create({...req.body,companyId:cid(req)})})}catch(e){next(e)}});
router.put('/production/:id',requirePermission('production:write'),async(req,res,next)=>{try{const item=await ProductionItem.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:req.body},{new:true,runValidators:true});if(!item)return res.status(404).json({error:'Production item not found'});res.json({item})}catch(e){next(e)}});
router.delete('/production/:id',requirePermission('production:write'),async(req,res,next)=>{try{const item=await ProductionItem.findOneAndDelete({_id:req.params.id,companyId:cid(req)});if(!item)return res.status(404).json({error:'Production item not found'});res.json({ok:true})}catch(e){next(e)}});

// AI Quality Control queue
router.get('/quality',async(req,res,next)=>{try{res.json({audits:await QualityAudit.find({companyId:cid(req)}).populate('projectId','name sku status').sort({updatedAt:-1})})}catch(e){next(e)}});
router.post('/quality',requirePermission('quality:write'),async(req,res,next)=>{try{res.status(201).json({audit:await QualityAudit.create({...req.body,companyId:cid(req)})})}catch(e){next(e)}});
router.put('/quality/:id',requirePermission('quality:write'),async(req,res,next)=>{try{const patch={...req.body};if(['approved','rejected'].includes(patch.status)){patch.reviewedBy=uid(req);patch.reviewedAt=new Date();}const a=await QualityAudit.findOneAndUpdate({_id:req.params.id,companyId:cid(req)},{$set:patch},{new:true,runValidators:true});if(!a)return res.status(404).json({error:'Quality audit not found'});res.json({audit:a})}catch(e){next(e)}});

router.post('/store/export',requirePermission('products:read'),async(req,res,next)=>{try{const ids=req.body.projectIds||[];const products=await WorkspaceProject.find({_id:{$in:ids},companyId:cid(req)});const rows=products.map(p=>({sku:p.sku||'',name:p.name,category:p.category||'',fabric:p.fabric||'',color:p.color||'',style:p.style||'',description:p.listing?.description||'',seo_title:p.seo?.title||'',seo_description:p.seo?.description||'',image:p.mockupAssets?.[0]||p.sourceImages?.[0]||''}));const csv=[Object.keys(rows[0]||{sku:'',name:''}).join(','),...rows.map(r=>Object.values(r).map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','))].join('\n');res.json({filename:`fabricnow-store-${Date.now()}.csv`,csv,products:rows})}catch(e){next(e)}});
router.post('/factory/batch',requirePermission('products:write'),async(req,res,next)=>{try{const names=(req.body.names||[]).map(x=>String(x).trim()).filter(Boolean);const projects=await WorkspaceProject.insertMany(names.map(name=>({userId:uid(req),companyId:cid(req),name,status:'processing',readiness:0,tasks:[{name:'Product capture',status:'todo'},{name:'Garment intelligence',status:'todo'},{name:'Product content',status:'todo'},{name:'Quality review',status:'todo'}]})));res.status(202).json({projects,message:`${projects.length} products queued for the Fashion Product Factory.`})}catch(e){next(e)}});
router.get('/api/manifest',async(req,res)=>res.json({version:'3.0',companyScoped:true,modules:['capture','garment-intelligence','fabrics','measurements','tech-packs','production','quality-control','projects','collections','asset-library','team','brand-kit','integrations','apps','store-sync','api','analytics']}));
module.exports=router;
