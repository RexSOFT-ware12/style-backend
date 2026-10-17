const { Schema, model } = require('mongoose');
const assetSchema = new Schema({
  name:{type:String,required:true}, type:{type:String,default:'image'}, url:String, mime:String, size:Number,
  status:{type:String,enum:['draft','processing','review','approved','published','rejected'],default:'draft'}, tags:[String], metadata:{type:Schema.Types.Mixed,default:{}}
},{timestamps:true});
const taskSchema = new Schema({name:String,status:{type:String,enum:['todo','running','done','failed'],default:'todo'},progress:{type:Number,default:0},message:String},{_id:false});
const workspaceProjectSchema = new Schema({
  companyId:{type:Schema.Types.ObjectId,ref:'Company',index:true},
  userId:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true}, name:{type:String,required:true}, sku:String, category:String, brand:String, fabric:String, color:String, style:String,
  status:{type:String,enum:['draft','processing','review','approved','published','archived'],default:'draft'},
  sourceImages:[String], extractedParts:[{name:String,url:String}], fabricAssets:[String], patternAssets:[String], mockupAssets:[String],
  technicalFlat:{front:String,back:String,notes:String}, measurements:{type:Schema.Types.Mixed,default:{}}, bom:[{item:String,specification:String,quantity:String}], listing:{type:Schema.Types.Mixed,default:{}}, seo:{type:Schema.Types.Mixed,default:{}},
  readiness:{type:Number,default:0}, reviewNotes:[String], tasks:[taskSchema], assets:[assetSchema], collectionId:{type:Schema.Types.ObjectId,ref:'WorkspaceCollection',default:null}, version:{type:Number,default:1}, meta:{type:Schema.Types.Mixed,default:{}}
},{timestamps:true});
workspaceProjectSchema.set('toJSON',{virtuals:true,transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;}});
module.exports=model('WorkspaceProject',workspaceProjectSchema);
