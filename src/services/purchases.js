'use strict';
const acc=require('./accounting'), stock=require('./stock');
const {nextCode}=require('./sales');

async function createPurchase(db,{items,supplierId,date,paymentMethod='cash',paid,notes,userId}){
  return db.tx(async(t)=>{
    let total=0; const lines=[];
    for(const it of items){
      const p=await t.find('products',{id:it.product_id});
      if(!p) throw Object.assign(new Error('Produk tidak ditemukan: '+it.product_id),{status:404});
      const qty=+it.qty, price=+(it.unit_price ?? p.buy_price);
      const lt=+(qty*price).toFixed(2); total+=lt; lines.push({p,qty,price,lt});
    }
    const pur=await t.insert('purchases',{
      code: await nextCode(t,'purchases','code','PO-'), supplier_id:supplierId||null, date:date||new Date().toISOString().slice(0,10),
      payment_method:paymentMethod, status:'received', total:+total.toFixed(2), paid: paid!=null? +paid : (paymentMethod==='credit'?0:+total.toFixed(2)),
      notes:notes||null, created_by:userId||null });
    for(const l of lines){
      await t.insert('purchase_items',{purchase_id:pur.id,product_id:l.p.id,qty:l.qty,unit_price:l.price,total:l.lt});
      await stock.applyCost(t,l.p,l.qty,l.price);
      await stock.move(t,{product:l.p,qty:l.qty,type:'purchase',refType:'purchase',refId:pur.id,userId});
    }
    const unpaid=+((+pur.total)-(+pur.paid)).toFixed(2);
    const j=[];
    if(+pur.paid>0){ const a=paymentMethod==='transfer'?'Bank':'Kas'; j.push({account:a,debit:0,credit:+pur.paid},{account:'Beban Pokok (HPP)',debit:+pur.paid,credit:0}); }
    if(unpaid>0) j.push({account:'Utang Dagang',debit:0,credit:unpaid},{account:'Beban Pokok (HPP)',debit:unpaid,credit:0});
    await acc.post(t,{date:pur.date,refType:'purchase',refId:pur.id,description:'Pembelian '+pur.code,userId,lines:j});
    return pur;
  });
}

/** Bayar sebagian/keseluruhan utang pembelian. */
async function payPurchase(db,id,amount,method='cash',userId){
  return db.tx(async(t)=>{
    const p=await t.find('purchases',{id}); if(!p) throw Object.assign(new Error('Pembelian tidak ditemukan'),{status:404});
    const outstanding=+((+p.total)-(+p.paid)).toFixed(2);
    const amt=+(amount!=null?Math.min(+amount,outstanding):outstanding).toFixed(2);
    if(amt<=0) throw Object.assign(new Error('Tidak ada utang tersisa'),{status:409});
    await t.update('purchases',{id},{paid:+(+p.paid+amt).toFixed(2)});
    await acc.post(t,{date:new Date().toISOString().slice(0,10),refType:'purchase',refId:id,description:'Pembayaran utang '+p.code,userId,
      lines:[{account:'Utang Dagang',debit:amt,credit:0},{account:method==='transfer'?'Bank':'Kas',debit:0,credit:amt}]});
    return t.find('purchases',{id});
  });
}
module.exports={createPurchase,payPurchase};
