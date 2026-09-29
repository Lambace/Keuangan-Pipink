'use strict';
const ex=require('express'); const getDb=require('../db'); const A=require('../middleware/auth');
const salesSvc=require('../services/sales');
const r=ex.Router(); r.use(A.requireAuth);

r.get('/',async(req,res,next)=>{try{const db=getDb();
  let rows=await db.all('sales',{orderBy:{id:'desc'}});
  if(req.query.from) rows=rows.filter(s=>String(s.date)>=req.query.from);
  if(req.query.to) rows=rows.filter(s=>String(s.date)<=req.query.to);
  res.json(rows);}catch(e){next(e);}});

r.get('/:id',async(req,res,next)=>{try{const db=getDb();
  const s=await db.find('sales',{id:+req.params.id}); if(!s) return res.status(404).json({error:'Tidak ditemukan'});
  s.items=await db.all('sale_items',{sale_id:s.id}); res.json(s);}catch(e){next(e);}});

r.post('/',async(req,res,next)=>{try{const db=getDb();
  const b=req.body||{}; if(!Array.isArray(b.items)||!b.items.length) return res.status(400).json({error:'items wajib'});
  const sale=await salesSvc.createSale(db,{...b,userId:req.user.id});
  res.status(201).json(sale);}catch(e){next(e);}});

r.post('/:id/void',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
  res.json(await salesSvc.voidSale(db,+req.params.id,req.user.id));}catch(e){next(e);}});
module.exports=r;
