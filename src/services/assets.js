'use strict';
const acc=require('./accounting');

/** Depresiasi garis lurus per bulan. */
function monthlyDep(a){
  if(a.depreciation_method==='none') return 0;
  const base=(+a.purchase_price)-(+a.salvage_value||0);
  return +(base/(+a.useful_life_months||1)).toFixed(2);
}
function monthsSince(dateStr,until=new Date()){
  const d=new Date(dateStr); let m=(until.getFullYear()-d.getFullYear())*12+(until.getMonth()-d.getMonth());
  if(until.getDate()<d.getDate()) m--; return Math.max(0,m);
}
async function assetBook(db){
  const assets=await db.all('assets',{});
  // Sumber kebenaran akumulasi depresiasi: buku besar (ledger) gabungan dari
  //   (1) posting awal saat pencatatan aset (refType='asset_buy') — kredit akun
  //       'Akum Depresiasi' sebesar depresiasi berjalan sejak tanggal pembelian, dan
  //   (2) posting rutin bulanan oleh worker (refType='depreciation').
  // Kolom accumulated_dep pada baris aset hanya cerminan cepat; nilainya dipulihkan
  // dari buku besar bila kolom tersebut kosong (mis. pada engine penyimpanan yang
  // tidak menyimpan kolom di luar skema).
  let ledgerAccum=null;
  try{
    const accA=await db.find('accounts',{name:'Akum Depresiasi'});
    if(accA){
      const ledRaw=await db.all('ledger',{account_id:accA.id});
      const entries=await db.all('journal_entries',{});
      const byId={}; for(const e of entries) byId[String(e.id)]=e;
      const led=ledRaw.map(l=>({...l, ...(byId[String(l.entry_id)]||{})}));
      ledgerAccum={};
      for(const l of led){
        if((l.ref_type==='depreciation'||l.ref_type==='asset_buy')&&l.ref_id!=null){
          const k=String(l.ref_id);
          ledgerAccum[k]=(ledgerAccum[k]||0)+(+l.credit||0)-(+l.debit||0);
        }
      }
    }
  }catch(e){ /* tabel ledger belum ada -> pakai perhitungan kolom saja */ }
  return assets.map(a=>{
    // Batasi bulan efektif: depresiasi tidak melebihi umur ekonomis aset.
    const capMonths=+a.useful_life_months||Infinity;
    const rawM=a.status==='active'?monthsSince(a.purchase_date):monthsSince(a.purchase_date,a.sold_date?new Date(a.sold_date):new Date());
    const m=Math.max(0,Math.min(rawM,capMonths));
    const depreciableBase=(+a.purchase_price)-(+a.salvage_value||0);
    const ownCol=+a.accumulated_dep||0;
    const ownLedger=(ledgerAccum&&ledgerAccum[String(a.id)])||0;
    // Pilih sumber dengan nominal lebih tinggi (kolom vs buku besar) lalu batasi
    // agar tidak pernah melebihi dasar depresiasi — mencegah hitung-ganda.
    const booked=Math.min(Math.max(ownCol,ownLedger),depreciableBase);
    // Tambahkan proyeksi garis lurus HANYA bila sama sekali tidak ada catatan nyata
    // (aset lama yang belum pernah dibukukan depresiasinya).
    const hasRealRecord=ownCol>0||ownLedger>0;
    const depPerMonth=capMonths>0?depreciableBase/capMonths:0;
    const accum=hasRealRecord?booked:Math.min(m*depPerMonth,depreciableBase);
    return {...a, monthly_dep:monthlyDep(a), accumulated:+accum.toFixed(2), book_value:+((+a.purchase_price)-accum).toFixed(2)};
  });
}
async function recordPurchase(db,{name,category,purchaseDate,purchasePrice,usefulLifeMonths=48,salvageValue=0,method='straight_line',location,paidCash=true,userId,accumulatedDep=0}){
  return db.tx(async(t)=>{
    const a=await t.insert('assets',{name,category:category||null,purchase_date:purchaseDate||new Date().toISOString().slice(0,10),
      purchase_price:+purchasePrice,useful_life_months:usefulLifeMonths,salvage_value:+salvageValue||0,depreciation_method:method,
      accumulated_dep:+accumulatedDep||0,
      status:'active',location:location||null});
    await acc.post(t,{date:a.purchase_date,refType:'asset_buy',refId:a.id,description:'Pembelian aset '+name,userId,
      lines:[{account:paidCash?'Kas':'Bank',debit:0,credit:+purchasePrice},{account:'Aset Tetap',debit:+purchasePrice,credit:0}]});
    return a;
  });
}
async function sellAsset(db,id,soldPrice,soldDate,userId){
  return db.tx(async(t)=>{
    const list=await assetBook(t); const a=list.find(x=>x.id==id);
    if(!a) throw Object.assign(new Error('Aset tidak ditemukan'),{status:404});
    if(a.status!=='active') throw Object.assign(new Error('Aset tidak aktif'),{status:409});
    const price=+soldPrice, bv=+a.book_value;
    await t.update('assets',{id},{status:'sold',sold_date:soldDate||new Date().toISOString().slice(0,10),sold_price:price});
    const lines=[{account:'Kas',debit:price,credit:0},{account:'Aset Tetap',debit:0,credit:+a.purchase_price}];
    if(price>=bv) lines.push({account:'Keuntungan Penjualan Aset',debit:0,credit:+(price-bv).toFixed(2)});
    else lines.push({account:'Kerugian Penjualan Aset',debit:+(bv-price).toFixed(2),credit:0});
    await acc.post(t,{date:lines[0]? (soldDate||new Date().toISOString().slice(0,10)):null,refType:'asset_sell',refId:id,description:'Penjualan aset '+a.name,userId,lines});
    return t.find('assets',{id});
  });
}
module.exports={assetBook,recordPurchase,sellAsset,monthlyDep,monthsSince};
