'use strict';
const ex=require('express'), fs=require('fs'), path=require('path'), crypto=require('crypto');
const multer=require('multer');
const config=require('../config'); const getDb=require('../db'); const A=require('../middleware/auth');
const ocr=require('../services/ocr'); const pSvc=require('../services/purchases');
const r=ex.Router(); r.use(A.requireAuth);

let uploadHandler=null;
try{ // multer hanya dipakai utk jalur multipart; bila konfigurasi gagal, jalur teks tetap berfungsi
  const storage=multer.diskStorage({destination:(req,_,cb)=>{fs.mkdirSync(config.state.uploadDir,{recursive:true});cb(null,config.state.uploadDir);},
    filename:(_,f,cb)=>{ const ext=path.extname(f.originalname)||'.jpg'; cb(null,'rc-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+ext.toLowerCase()); }});
  const up=multer({storage,limits:{fileSize:8*1024*1024},fileFilter:(req,f,cb)=>{
    const ok=/\.(jpe?g|png|webp|txt)$/i.test(f.originalname); cb(ok?null:new Error('Format file tidak didukung'),ok); }});
  uploadHandler=(req,res,next)=>up.single('image')(req,res,e=>e?res.status(400).json({error:'Upload tidak valid: '+(e.message||e.code)}):next());
}catch(e){ console.warn('[receipts] multer tidak tersedia:',e.message); }

r.post('/upload',uploadHandler||((req,res,next)=>next()),async(req,res,next)=>{
  try{
    const db=getDb();
    // Baca teks struk dari salah satu sumber: field raw_text (JSON / form-urlencoded),
    // file .txt yang diunggah, atau sidecar .txt di samping gambar.
    let rawText=(typeof req.body?.raw_text==='string')?req.body.raw_text.trim():'';
    if(!rawText && req.file && /\.txt$/i.test(req.file.originalname||'')){
      rawText=fs.readFileSync(path.join(config.state.uploadDir,req.file.filename),'utf8').trim();
    }
    const imgPath=req.file&&!/\.txt$/i.test(req.file.originalname||'')?path.join(config.state.uploadDir,req.file.filename):null;
    if(imgPath&&rawText){ fs.writeFileSync(imgPath+'.txt',rawText); }
    if(!imgPath && !rawText){
      // sidecar untuk jalur pengujian berbasis gambar di path lain
      const p=req.body?.image_path; if(p){ const side=p+'.txt'; if(fs.existsSync(side)) rawText=fs.readFileSync(side,'utf8'); }
    }
    const rec=await db.insert('receipts',{image_path:req.file?req.file.filename:null,status:'pending',created_by:req.user.id});
    const out=await ocr.processReceipt(imgPath,rawText);
    await db.update('receipts',{id:rec.id},{status:out.parsed.items.length||out.parsed.total?'processed':'failed',
      engine:out.engine,raw_text:out.text.slice(0,20000),parsed:out.parsed,confidence:out.parsed.confidence});
    res.status(201).json({...rec,status:(out.parsed.items.length||out.parsed.total)?'processed':'failed',engine:out.engine,parsed:out.parsed});
  }catch(e){next(e);}
});

r.get('/',async(req,res,next)=>{try{
  const rows=await getDb().all('receipts',{orderBy:{id:'desc'}});
  res.json(rows.map(({raw_text,...x})=>x));}catch(e){next(e);}});

r.get('/:id',async(req,res,next)=>{try{const x=await getDb().find('receipts',{id:+req.params.id});
  if(!x) return res.status(404).json({error:'Tidak ditemukan'}); res.json(x);}catch(e){next(e);}});

/** Konfirmasi hasil OCR -> buat pembelian (stok + jurnal otomatis). */
r.post('/:id/confirm',async(req,res,next)=>{
  try{
    const db=getDb(); const rec=await db.find('receipts',{id:+req.params.id});
    if(!rec) return res.status(404).json({error:'Tidak ditemukan'});
    if(rec.converted_purchase_id) return res.status(409).json({error:'Sudah dikonversi'});
    const parsed=req.body.parsed|| (typeof rec.parsed==='string'?JSON.parse(rec.parsed):rec.parsed);
    const items=[];
    for(const it of (parsed.items||[])){
      let pid=it.product_id ?? it.productId ?? null;
      // Bila produk belum dipetakan, coba cocokkan otomatis berdasarkan nama/SKU struk.
      if(!pid && (it.name||it.product_name)){
        const key=String(it.name||it.product_name).toLowerCase().trim();
        const prods=await db.all('products',{});
        const cand=prods.find(p=>String(p.sku||'').toLowerCase()===key)
          ||prods.find(p=>{const n=String(p.name||'').toLowerCase(); return n===key || n.includes(key) || key.includes(n.split(' ')[0]) && key.split(' ').every(w=>n.includes(w));});
        if(cand) pid=cand.id;
      }
      if(!pid) continue; // hanya item yang sudah dipetakan produknya
      items.push({product_id:pid,qty:+it.qty||1,unit_price:+(it.unit_price ?? it.price ?? 0)||0});
    }
    if(!items.length) return res.status(400).json({error:'Tidak ada item yang dipetakan ke produk. Sertakan product_id pada tiap item.'});
    let supplierId=req.body.supplier_id ?? req.body.supplierId ?? null;
    if(!supplierId && parsed.store){
      const sup=(await db.all('suppliers',{})).find(s=>String(s.name).toLowerCase()===String(parsed.store).toLowerCase());
      supplierId=sup?sup.id:null;
    }
    const pur=await pSvc.createPurchase(db,{items,supplierId,date:parsed.date,
      paymentMethod:req.body.payment_method||req.body.paymentMethod||'cash',
      paid:req.body.paid??parsed.total, notes:'Dari struk #'+rec.id, userId:req.user.id});
    await db.update('receipts',{id:rec.id},{status:'confirmed',converted_purchase_id:pur.id});
    res.json({receipt:await db.find('receipts',{id:rec.id}),purchase:pur});
  }catch(e){next(e);}
});
module.exports=r;
