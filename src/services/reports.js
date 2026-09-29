'use strict';
/** Laporan & Analitik Bisnis. */
const inRange=(r,from,to)=>{ const d=String(r.date||'').slice(0,10); return (!from||d>=from)&&(!to||d<=to); };

async function summary(db,{from,to}){
  const sales=(await db.all('sales',{})).filter(s=>s.status==='completed'&&inRange(s,from,to));
  const items=await db.all('sale_items',{});
  const revenue=+sales.reduce((s,x)=>s+(+x.total),0).toFixed(2);
  let cogs=0; for(const s of sales){ cogs+=items.filter(i=>i.sale_id==s.id).reduce((t,i)=>t+(+i.qty*+i.cogs_unit),0); }
  const expenses=(await db.all('expenses',{})).filter(e=>inRange(e,from,to));
  const expTot=+expenses.reduce((s,x)=>s+(+x.amount),0).toFixed(2);
  const incomes=(await db.all('incomes',{})).filter(e=>inRange(e,from,to));
  const incTot=+incomes.reduce((s,x)=>s+(+x.amount),0).toFixed(2);
  const gross=+(revenue-cogs).toFixed(2);
  const net=+(gross-expTot+incTot).toFixed(2);
  const purchases=(await db.all('purchases',{})).filter(p=>inRange(p,from,to));
  const purTot=+purchases.reduce((s,x)=>s+(+x.total),0).toFixed(2);
  const payables=+purchases.reduce((s,x)=>s+((+x.total)-(+x.paid)),0).toFixed(2);
  const receivables=+sales.filter(s=>s.payment_method==='credit').reduce((s,x)=>s+((+x.total)-(+x.paid||0)),0).toFixed(2);
  return { revenue, cogs:+cogs.toFixed(2), gross_profit:gross, gross_margin: revenue? +(gross/revenue*100).toFixed(1):0,
    expenses:expTot, other_income:incTot, net_profit:net, net_margin: revenue? +(net/revenue*100).toFixed(1):0,
    purchase_total:purTot, payables, receivables, tx_count:sales.length };
}
async function daily(db,{from,to,days=30}){
  const sales=(await db.all('sales',{})).filter(s=>s.status==='completed');
  const map={};
  for(const s of sales){ const d=String(s.date).slice(0,10); if(!inRange(s,from,to)) continue;
    map[d]=map[d]||{date:d,revenue:0,cogs:0,count:0}; map[d].revenue+=+s.total; map[d].count++; }
  const items=await db.all('sale_items',{});
  for(const s of sales){ const d=String(s.date).slice(0,10); if(map[d]) map[d].cogs+=items.filter(i=>i.sale_id==s.id).reduce((t,i)=>t+(+i.qty*+i.cogs_unit),0); }
  return Object.values(map).sort((a,b)=>a.date<b.date?-1:1).slice(-days)
    .map(x=>({date:x.date,revenue:+x.revenue.toFixed(2),cogs:+x.cogs.toFixed(2),profit:+(x.revenue-x.cogs).toFixed(2),orders:x.count}));
}
async function byProduct(db,{from,to}){
  const sales=(await db.all('sales',{})).filter(s=>s.status==='completed'&&inRange(s,from,to));
  const ids=new Set(sales.map(s=>String(s.id)));
  const items=await db.all('sale_items',{}).filter(i=>ids.has(String(i.sale_id)));
  const products=await db.all('products',{});
  const agg={};
  for(const i of items){ const k=String(i.product_id); agg[k]=agg[k]||{qty:0,revenue:0,cogs:0};
    agg[k].qty+=+i.qty; agg[k].revenue+=+i.total; agg[k].cogs+=(+i.qty*+i.cogs_unit); }
  return Object.entries(agg).map(([pid,v])=>{
    const p=products.find(x=>String(x.id)===pid)||{};
    return {product_id:+pid,name:p.name||('#'+pid),unit:p.unit||'',qty:+v.qty.toFixed(3),revenue:+v.revenue.toFixed(2),
      cogs:+v.cogs.toFixed(2),profit:+(v.revenue-v.cogs).toFixed(2),margin:v.revenue?+((v.revenue-v.cogs)/v.revenue*100).toFixed(1):0};
  }).sort((a,b)=>b.revenue-a.revenue);
}
async function byCategory(db,f){
  const prods=await db.all('products',{}); const cats=await db.all('categories',{});
  const ps=await byProduct(db,f); const agg={};
  for(const x of ps){ const p=prods.find(q=>String(q.id)===String(x.product_id)); const cid=p?.category_id||0;
    agg[cid]=agg[cid]||{revenue:0,profit:0,qty:0}; agg[cid].revenue+=x.revenue; agg[cid].profit+=x.profit; agg[cid].qty+=x.qty; }
  return Object.entries(agg).map(([cid,v])=>({category:(cats.find(c=>String(c.id)===cid)||{}).name||'Tanpa Kategori',
    revenue:+v.revenue.toFixed(2),profit:+v.profit.toFixed(2),qty:+v.qty.toFixed(3)})).sort((a,b)=>b.revenue-a.revenue);
}
async function topProducts(db,f,n=5){ const l=await byProduct(db,f); return {best:l.slice(0,n),worst:[...l].reverse().slice(0,n)}; }
async function slowMoving(db,f){
  const sales=(await db.all('sales',{})).filter(s=>s.status==='completed'&&inRange(s,f.from,f.to));
  const ids=new Set(sales.map(s=>String(s.id)));
  const sold=new Set(await db.all('sale_items',{}).filter(i=>ids.has(String(i.sale_id))).map(i=>String(i.product_id)));
  const products=await db.all('products',{is_active:true});
  return products.filter(p=>!sold.has(String(p.id))).map(p=>({id:p.id,name:p.name,stock:+p.stock,unit:p.unit,value:+(+p.stock*+p.buy_price).toFixed(2)}));
}
async function inventoryValuation(db){
  const products=await db.all('products',{is_active:true});
  let total=0; const low=[];
  for(const p of products){ const v=+((+p.stock)*(+p.buy_price)); total+=v; if(+p.stock<=+p.min_stock) low.push({id:p.id,name:p.name,stock:+p.stock,min:+p.min_stock,unit:p.unit}); }
  return {total_value:+total.toFixed(2), product_count:products.length, low_stock:low};
}
async function profitLoss(db,{from,to}){
  const s=await summary(db,{from,to});
  const expenses=await db.all('expenses',{}); const inc=await db.all('incomes',{});
  const byCat={}; for(const e of expenses.filter(x=>inRange(x,from,to))) byCat[e.category]=(byCat[e.category]||0)+ +e.amount;
  return {...s, expense_breakdown:Object.entries(byCat).map(([k,v])=>({category:k,amount:+v.toFixed(2)})).sort((a,b)=>b.amount-a.amount),
    income_breakdown:Object.entries(inc.filter(x=>inRange(x,from,to)).reduce((m,x)=>((m[x.category]=(m[x.category]||0)+ +x.amount),m),{})).map(([k,v])=>({category:k,amount:+v.toFixed(2)}))};
}
async function balanceSheet(db){
  const accounts=await db.all('accounts',{});
  const g=t=>accounts.filter(a=>a.type===t).reduce((s,a)=>s+ +a.balance,0);
  const assets=g('cash')+g('bank')+g('receivable')+ (await inventoryValuation(db)).total_value - g('expense')*0; // kas+bank+piutang+persediaan
  const liab=g('payable');
  const equity=accounts.filter(a=>a.type==='equity').reduce((s,a)=>s+ +a.balance,0);
  const retained=accounts.filter(a=>['revenue','cogs','expense'].includes(a.type)).reduce((s,a)=>s+ +a.balance,0);
  return { cash:+g('cash').toFixed(2), bank:+g('bank').toFixed(2), receivables:+g('receivable').toFixed(2),
    inventory:assets-(g('cash')+g('bank')+g('receivable')), total_assets:+assets.toFixed(2),
    payables:+liab.toFixed(2), total_liabilities:+liab.toFixed(2),
    equity:+(equity+retained*-1*(1)+equity*0+retained*0).toFixed(2), retained_earnings:+retained.toFixed(2),
    capital_equity:+equity.toFixed(2), total_equity:+(equity+retained).toFixed(2) };
}
module.exports={summary,daily,byProduct,byCategory,topProducts,slowMoving,inventoryValuation,profitLoss,balanceSheet,inRange};
