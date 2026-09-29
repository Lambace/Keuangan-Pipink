'use strict';
const ex=require('express'); const getDb=require('../db'); const A=require('../middleware/auth');
const aSvc=require('../services/assets'); const acc=require('../services/accounting');
const r=ex.Router(); r.use(A.requireAuth);
r.get('/',async(req,res,next)=>{try{res.json(await aSvc.assetBook(getDb()));}catch(e){next(e);}});
r.post('/',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
  const b=req.body||{};
  // Terima penamaan field camelCase maupun snake_case (usefulLifeMonths / useful_life_months).
  const pick=(...ks)=>{ for(const k of ks) if(b[k]!==undefined&&b[k]!==null&&b[k]!=='') return b[k]; return undefined; };
  const name=pick('name');
  const purchasePrice=pick('purchase_price','purchasePrice','price','cost');
  const usefulLifeMonths=pick('useful_life_months','usefulLifeMonths','useful_life','life_months');
  const salvageValue=pick('salvage_value','salvageValue','salvage');
  const purchaseDate=pick('purchase_date','purchaseDate','date');
  if(!name||!(+purchasePrice>0)) return res.status(400).json({error:'name & purchase_price wajib'});
  const ufm=(usefulLifeMonths!==undefined?+usefulLifeMonths:48)||48;
  const sv=(salvageValue!==undefined?+salvageValue:0);
  const pd=purchaseDate||new Date().toISOString().slice(0,10);
  // Depresiasi berjalan (garis lurus) sejak tanggal pembelian sampai hari ini — dibukukan
  // sebagai Beban Depresiasi (akumulasi di ledger), sesuai standar akuntansi.
  const created=await aSvc.recordPurchase(db,{name,category:pick('category','category_id'),
    purchaseDate,purchasePrice,usefulLifeMonths:ufm,salvageValue:sv,
    method:pick('method','depreciation_method'),location:pick('location'),paidCash:b.paid_cash!==false&&b.paidCash!==false,userId:req.user.id});
  // Depresiasi berjalan sejak tanggal pembelian sampai hari ini (garis lurus). Akumulasi disimpan
  // pada baris aset (accumulated_dep) dan dibukukan sebagai Beban Depresiasi dengan referensi ke id
  // aset (refId) agar nilai buku konsisten dan dapat ditelusuri di buku besar.
  const base=(+purchasePrice)-sv;
  const m=aSvc.monthsSince(pd);
  const dep=Math.min(Math.round(m*base/ufm*100)/100, base);
  let result=created;
  if(dep>0){
    await db.update('assets',{id:created.id},{accumulated_dep:dep});
    await acc.post(db,{date:pd,refType:'depreciation',refId:created.id,description:'Akumulasi depresiasi aset '+name+' ('+m+' bulan x garis lurus)',userId:req.user.id,
      lines:[{account:'Beban Depresiasi',debit:dep,credit:0},{account:'Akum Depresiasi',debit:0,credit:dep}]});
    result=await db.find('assets',{id:created.id});
  }
  res.status(201).json(result);}catch(e){next(e);}});
r.post('/:id/sell',A.requireRole('owner','admin'),async(req,res,next)=>{try{const db=getDb();
  if(!(+req.body?.sold_price>=0)) return res.status(400).json({error:'sold_price wajib'});
  res.json(await aSvc.sellAsset(db,+req.params.id,req.body.sold_price,req.body.sold_date,req.user.id));}catch(e){next(e);}});
module.exports=r;
