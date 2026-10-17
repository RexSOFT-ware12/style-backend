require('dotenv').config();
const { connectDB } = require('../db');
const User = require('../models/User');
const Company = require('../models/Company');
const CompanyMembership = require('../models/CompanyMembership');
const WorkspaceProject = require('../models/WorkspaceProject');
const WorkspaceCollection = require('../models/WorkspaceCollection');
const WorkspaceAsset = require('../models/WorkspaceAsset');
const WorkspaceTeam = require('../models/WorkspaceTeam');

async function main(){
  await connectDB();
  const users = await User.find({});
  let companies=0, memberships=0, migrated=0;
  for(const user of users){
    let membership=await CompanyMembership.findOne({userId:user._id,status:'active'}).sort({createdAt:1});
    let company=membership ? await Company.findById(membership.companyId) : null;
    if(!company){
      const name=String(user.companyName||`${user.name||'My'} Company`).trim()||'My Company';
      const base=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||`company-${String(user._id).slice(-8)}`;
      let slug=base,i=2; while(await Company.exists({slug})) slug=`${base}-${i++}`;
      company=await Company.create({name,slug,ownerId:user._id}); companies++;
      membership=await CompanyMembership.create({companyId:company._id,userId:user._id,role:'owner',status:'active',permissions:['*']}); memberships++;
    }
    const companyId=company._id;
    const r1=await WorkspaceProject.updateMany({userId:user._id,companyId:{$exists:false}},{$set:{companyId}});
    const r2=await WorkspaceCollection.updateMany({userId:user._id,companyId:{$exists:false}},{$set:{companyId}});
    const r3=await WorkspaceAsset.updateMany({userId:user._id,companyId:{$exists:false}},{$set:{companyId}});
    const r4=await WorkspaceTeam.updateMany({userId:user._id,companyId:{$exists:false}},{$set:{companyId}});
    migrated += (r1.modifiedCount||0)+(r2.modifiedCount||0)+(r3.modifiedCount||0)+(r4.modifiedCount||0);
  }
  console.log(`Company migration complete: ${companies} companies, ${memberships} memberships, ${migrated} workspace records updated.`);
  process.exit(0);
}
main().catch(err=>{console.error(err);process.exit(1)});
