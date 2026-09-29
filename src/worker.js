'use strict';
/**
 * Worker periodik PASAR MINI:
 * - Depresiasi aset bulanan otomatis (posting jurnal).
 * - Deteksi stok menipis -> alert.
 * Jalankan terpisah dari web server: `npm run worker`.
 */
const config=require('./config');
(async()=>{
  await config.init();
  const getDb=require('./db'); const acc=require('./services/accounting'); const aSvc=require('./services/assets');
  async function tick(){
    const db=getDb();
    try{
      const month=new Date().toISOString().slice(0,7);
      const books=await aSvc.assetBook(db);
      for(const a of books){
        if(a.status!=='active'||a.monthly_dep<=0) continue;
        const done=await db.all('journal_entries',{ref_type:'depreciation'});
        if(done.some(j=>String(j.date).startsWith(month)&&j.description?.includes('dep #'+a.id))) continue;
        await acc.post(db,{date:new Date().toISOString().slice(0,10),refType:'depreciation',refId:a.id,
          description:`Depresiasi ${month} aset "${a.name}" (dep #${a.id})`,userId:null,
          lines:[{account:'Akum Depresiasi',debit:a.monthly_dep,credit:0},{account:'Kas',debit:0,credit:a.monthly_dep}]});
        console.log('Depresiasi tercatat:',a.name,a.monthly_dep);
      }
      const low=await db.all('products',{is_active:true});
      for(const p of low) if(+p.stock<=+p.min_stock) console.warn(`[ALERT] Stok menipis: ${p.name} (${p.stock} ${p.unit} <= min ${p.min_stock})`);
    }catch(e){ console.error('[worker]',e.message); }
  }
  console.log('Worker PASAR MINI aktif (interval 60s).');
  await tick(); setInterval(tick,60000);
})();
