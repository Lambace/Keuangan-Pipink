'use strict';
/** Manajemen stok + rata-rata biaya (weighted average cost). */
async function move(db,{product,qty,type,refType,refId,note,userId,date}){
  const newStock=+((+product.stock)+(+qty)).toFixed(3);
  if(newStock<0) { const e=new Error(`Stok tidak mencukupi.`); e.status=409; throw e; }
  await db.update('products',{id:product.id},{stock:newStock});
  await db.insert('stock_movements',{product_id:product.id,type,qty:+qty,ref_type:refType||null,ref_id:refId||null,note:note||null,created_by:userId||null,date:date||new Date().toISOString()});
  product.stock=newStock; return product;
}
async function applyCost(db,product,qty,cost){
  // weighted average
  const oldQty=+product.stock, oldCost=+product.buy_price;
  const totalQty=oldQty+qty;
  const avg=totalQty>0? ((oldQty*oldCost)+(qty*cost))/totalQty : +cost;
  await db.update('products',{id:product.id},{buy_price:+avg.toFixed(2)});
  product.buy_price=+avg.toFixed(2);
}
module.exports={move,applyCost};
