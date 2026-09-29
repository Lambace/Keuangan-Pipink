'use strict';
const ex=require('express'); const getDb=require('../db'); const A=require('../middleware/auth');
const r=ex.Router(); r.use(A.requireAuth);

function entity(name,fields){
  r.get('/'+name,async(req,res,next)=>{try{const db=getDb();
    let opts={orderBy:{id:'desc'}}; if(req.query.q) opts.where={[fields[0]]:db.like?db.like(req.query.q):req.query.q};
    res.json(await db.all(name,opts));}catch(e){next(e);}});
  r.post('/'+name,async(req,res,next)=>{try{const db=getDb();
    const row={}; for(const f of fields) if(req.body[f]!==undefined) row[f]=req.body[f];
    if(!row[fields[0]]) return res.status(400).json({error:fields[0]+' wajib'});
    res.status(201).json(await db.insert(name,row));}catch(e){next(e);}});
  r.put('/'+name+'/:id',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
    const patch={}; for(const f of fields) if(req.body[f]!==undefined) patch[f]=req.body[f];
    await db.update(name,{id:+req.params.id},patch); res.json(await db.find(name,{id:+req.params.id}));}catch(e){next(e);}});
  r.delete('/'+name+'/:id',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
    await db.del(name,{id:+req.params.id}); res.json({ok:true});}catch(e){next(e);}});
}
entity('customers',['name','phone','address','notes']);
entity('suppliers',['name','phone','address','notes']);
entity('categories',['name']);
module.exports=r;
