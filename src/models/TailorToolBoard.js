const { Schema, model } = require('mongoose');
const boardSchema = new Schema({
  companyId:{type:Schema.Types.ObjectId,ref:'Company',required:true,index:true},
  userId:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true},
  name:{type:String,default:'Untitled Tailor Board',trim:true},
  projectId:{type:Schema.Types.ObjectId,ref:'WorkspaceProject',default:null,index:true},
  unit:{type:String,enum:['mm','cm','in'],default:'cm'},
  width:{type:Number,default:140}, height:{type:Number,default:180},
  operations:{type:[Schema.Types.Mixed],default:[]},
  layers:{type:[Schema.Types.Mixed],default:[]},
  notes:{type:String,default:''},
  aiContext:{type:Schema.Types.Mixed,default:{}},
},{timestamps:true});
boardSchema.set('toJSON',{virtuals:true,transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;}});
module.exports=model('TailorToolBoard',boardSchema);
