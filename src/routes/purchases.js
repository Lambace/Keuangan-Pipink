'use strict';
const ex=require('express'); const getDb=require('../db'); const A=require('../middleware/auth');
const pSvc=require('../services/purchases');
const r=ex.Router(); r.use(A.requireAuth);

r.get('/',async(req,res,next)=>{try{const db=getDb();
  let rows=await db.all('purchases',{orderBy:{id:'desc'}});
  if(req.query.from) rows=rows.filter(p=>String(p.date)>=req.query.from);
  if(req.query.to) rows=rows.filter(p=>String(p.date)<=req.query.to);
  res.json(rows);}catch(e){next(e);}});

r.get('/:id',async(req,res,next)=>{try{const db=getDb();
  const p=await db.find('purchases',{id:+req.params.id}); if(!p) return res.status(404).json({error:'Tidak ditemukan'});
  p.items=await db.all('purchase_items',{purchase_id:p.id}); res.json(p);}catch(e){next(e);}});

r.post('/',async(req,res,next)=>{try{const db=getDb();
  const b=req.body||{}; if(!Array.isArray(b.items)||!b.items.length) return res.status(400).json({error:'items wajib'});
  res.status(201).json(await pSvc.createPurchase(db,{...b,userId:req.user.id}));}catch(e){next(e);}});

r.post('/:id/pay',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
  res.json(await pSvc.payPurchase(db,+req.params.id,req.body?.amount,req.body?.payment_method||'cash',req.user.id));}catch(e){next(e);}});
module.exports=r;
