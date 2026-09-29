'use strict';
const ex=require('express'); const getDb=require('../db'); const A=require('../middleware/auth');
const stock=require('../services/stock');
const r=ex.Router(); r.use(A.requireAuth);

r.get('/',async(req,res,next)=>{try{const db=getDb();
  let rows=await db.all('products',{orderBy:{id:'desc'}});
  if(req.query.q){const q=String(req.query.q).toLowerCase(); rows=rows.filter(p=>p.name.toLowerCase().includes(q)||String(p.sku).toLowerCase().includes(q));}
  if(req.query.category_id) rows=rows.filter(p=>String(p.category_id)===String(req.query.category_id));
  res.json(rows);}catch(e){next(e);}});

r.get('/low-stock',async(req,res,next)=>{try{const db=getDb();
  const ps=await db.all('products',{is_active:true});
  res.json(ps.filter(p=>+p.stock<=+p.min_stock));}catch(e){next(e);}});

r.get('/:id/movements',async(req,res,next)=>{try{const db=getDb();
  res.json(await db.all('stock_movements',{product_id:+req.params.id},{orderBy:{id:'desc'},limit:200}));}catch(e){next(e);}});

r.post('/',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
  const b=req.body||{}; if(!b.name||!b.sku) return res.status(400).json({error:'name & sku wajib'});
  if(await db.find('products',{sku:b.sku})) return res.status(409).json({error:'SKU sudah dipakai'});
  const row={sku:b.sku,name:b.name,category_id:b.category_id||null,unit:b.unit||'pcs',
    buy_price:+b.buy_price||0,sell_price:+b.sell_price||0,stock:+b.stock||0,min_stock:+b.min_stock||0,
    perishable:!!b.perishable,expiry_days:b.expiry_days||null,is_active:b.is_active!==false};
  res.status(201).json(await db.insert('products',row));}catch(e){next(e);}});

r.put('/:id',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
  const b=req.body||{}; delete b.stock; // stok hanya lewat pergerakan
  const patch={}; for(const k of ['sku','name','category_id','unit','sell_price','min_stock','perishable','expiry_days','is_active']) if(b[k]!==undefined) patch[k]=b[k];
  await db.update('products',{id:+req.params.id},patch); res.json(await db.find('products',{id:+req.params.id}));}catch(e){next(e);}});

r.delete('/:id',A.requireRole('owner'),async(req,res,next)=>{try{const db=getDb();
  await db.update('products',{id:+req.params.id},{is_active:false}); res.json({ok:true});}catch(e){next(e);}});

/** Stock opname / penyesuaian manual. */
r.post('/:id/adjust',async(req,res,next)=>{try{const db=getDb();
  const p=await db.find('products',{id:+req.params.id}); if(!p) return res.status(404).json({error:'Produk tidak ditemukan'});
  const qty=+ (req.body?.qty||0); if(!qty) return res.status(400).json({error:'qty wajib (±)'});
  await stock.move(db,{product:p,qty,type:req.body.type||'adjustment',note:req.body.note||'Penyesuaian manual',userId:req.user.id});
  res.json(await db.find('products',{id:p.id}));}catch(e){next(e);}});
module.exports=r;
