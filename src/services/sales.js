'use strict';
const acc = require('./accounting');
const stock = require('./stock');

async function nextCode(db,table,col,prefix){
  const rows=await db.all(table,{orderBy:{id:'desc'},limit:50});
  let max=0;
  for(const r of rows){ const m=String(r[col]||'').match(/(\d+)$/); if(m) max=Math.max(max,+m[1]); }
  return prefix+String(max+1).padStart(4,'0');
}

/** Buat penjualan: validasi stok, hitung HPP rata-rata, jurnal double-entry, kas/piutang. */
async function createSale(db,{items,customerId,customer_id,date,paymentMethod,payment_method='cash',discount=0,tax=0,paid,notes,userId}){
  return db.tx(async(t)=>{
    let subtotal=0, cogsTotal=0; const lines=[];
    for(const it of items){
      const p=await t.find('products',{id:it.product_id});
      if(!p||p.is_active===false) throw Object.assign(new Error('Produk tidak ditemukan: '+it.product_id),{status:404});
      const qty=+it.qty; if(qty<=0) throw Object.assign(new Error('Qty harus > 0'),{status:400});
      const price=+(it.unit_price ?? p.sell_price);
      const disc=+(it.discount||0);
      const lineTotal=+(qty*price-disc).toFixed(2);
      subtotal+=lineTotal; cogsTotal+=qty*(+p.buy_price);
      lines.push({product:p,qty,price,disc,lineTotal});
    }
    const total=+(subtotal-(+discount||0)+(+tax||0)).toFixed(2);
    const sale=await t.insert('sales',{
      code: await nextCode(t,'sales','code','INV-'), customer_id:customerId||customer_id||null, date:date||new Date().toISOString().slice(0,10),
      payment_method:paymentMethod||payment_method, status:'completed', subtotal:+subtotal.toFixed(2), discount:+discount||0, tax:+tax||0, total,
      paid:paid!=null?+paid:total, change:+Math.max(0,(+paid||total)-total).toFixed(2), notes:notes||null, created_by:userId||null });
    for(const l of lines){
      await t.insert('sale_items',{sale_id:sale.id,product_id:l.product.id,qty:l.qty,unit_price:l.price,cogs_unit:l.product.buy_price,discount:l.disc,total:l.lineTotal});
      await stock.move(t,{product:l.product,qty:-l.qty,type:'sale',refType:'sale',refId:sale.id,userId});
    }
    // Jurnal double-entry: (D) Kas/Bank/Piutang ; (K) Pendapatan. HPP mengurangi persediaan (dihitung dari basis biaya per item).
    const pm = paymentMethod||payment_method;
    const assetAcct = pm==='transfer'||pm==='qris' ? 'Bank' : (pm==='credit'?'Pi Dagang':'Kas');
    const paidAmt = sale.paid, due=+(total-paidAmt).toFixed(2);
    const j=[{account:assetAcct,debit:+paidAmt,credit:0}];
    if(due>0) j.push({account:'Pi Dagang',debit:due,credit:0});
    j.push({account:'Pendapatan Penjualan',debit:0,credit:total});
    if(cogsTotal>0) j.push({account:'Beban Pokok (HPP)',debit:+cogsTotal.toFixed(2),credit:0},{account:'Persediaan',debit:0,credit:+cogsTotal.toFixed(2)});
    await acc.post(t,{date:sale.date,refType:'sale',refId:sale.id,description:'Penjualan '+sale.code,userId,lines:j});
    return {...sale, cogs:+cogsTotal.toFixed(2)};
  });
}

async function voidSale(db,id,userId){
  return db.tx(async(t)=>{
    const s=await t.find('sales',{id}); if(!s) throw Object.assign(new Error('Sales tidak ditemukan'),{status:404});
    if(s.status==='voided') throw Object.assign(new Error('Sudah dibatalkan'),{status:409});
    const items=await t.all('sale_items',{sale_id:id});
    let cogs=0;
    for(const it of items){ const p=await t.find('products',{id:it.product_id}); if(p){ cogs+=(+it.qty)*(+it.cogs_unit); await stock.move(t,{product:p,qty:+ +it.qty,type:'return',refType:'sale',refId:id,note:'Pembatalan penjualan',userId}); } }
    await t.update('sales',{id},{status:'voided'});
    const lines=[{account:'Pendapatan Penjualan',debit:+s.total,credit:0}];
    const paid=+s.paid||0, due=+(+s.total-paid).toFixed(2);
    if(paid>0) lines.push({account:'Kas',debit:0,credit:paid});
    if(due>0) lines.push({account:'Pi Dagang',debit:0,credit:due});
    if(cogs>0) lines.push({account:'Persediaan',debit:+cogs.toFixed(2),credit:0},{account:'Beban Pokok (HPP)',debit:0,credit:+cogs.toFixed(2)});
    await acc.post(t,{date:new Date().toISOString().slice(0,10),refType:'sale',refId:id,description:'Pembatalan '+s.code,userId,lines});
    return t.find('sales',{id});
  });
}
module.exports={createSale,voidSale,nextCode};
