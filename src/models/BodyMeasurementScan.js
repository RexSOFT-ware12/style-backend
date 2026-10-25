const {Schema,model}=require('mongoose');
const patternSchema=new Schema({garment:String,engineVersion:String,workerPatternId:String,outputs:{type:Schema.Types.Mixed,default:{}},createdAt:{type:Date,default:Date.now}});
const schema=new Schema({
 userId:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true},
 companyId:{type:Schema.Types.ObjectId,ref:'Company',index:true},
 name:{type:String,trim:true,default:'Body scan'},
 unit:{type:String,enum:['cm','in'],default:'cm'},
 height:{type:Number,required:true},
 status:{type:String,enum:['processing','completed','failed','review'],default:'processing'},
 measurements:{type:Schema.Types.Mixed,default:{}},
 confidence:{type:Schema.Types.Mixed,default:{}},
 imageCount:{type:Number,default:0},engineVersion:String,outputs:{type:Schema.Types.Mixed,default:{}},
 patterns:{type:[patternSchema],default:[]},
}, {timestamps:true});
schema.set('toJSON',{virtuals:true,transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;}});
module.exports=model('BodyMeasurementScan',schema);
