'use strict';
/** Uji end-to-end API PASAR MINI (storage engine file, terisolasi di direktori sementara). */
process.env.DB_MODE='file'; process.env.NODE_ENV='test';
const os=require('os'), fsx=require('fs');
process.env.PM_DATA_DIR = fsx.mkdtempSync(require('path').join(os.tmpdir(),'pm-test-'));
const nodeTest=require('node:test');
let test=nodeTest.test;
// Kumpulkan semua test lalu jalankan SEQUENSIAL setelah main() selesai,
// karena state global (token) bergantung pada urutan eksekusi.
const _cases=[];
test=(name,fn)=>{_cases.push({name,fn});};
const assert=require('node:assert');
const fs=require('fs'), path=require('path');
const main=async()=>{
  const config=require('../src/config'); await config.init();
  const getDb=require('../src/db'); const acc=require('../src/services/accounting');
  const db=getDb(); await acc.ensureAccounts(db);
  // Bootstrap data awal pada DB uji yang terisolasi (identik dengan seed produksi)
  if(!(await db.find('users',{email:'owner@pasarmini.id'}))){
    const bcrypt=require('bcryptjs');
    const mk=async(email,name,role,pw)=>db.insert('users',{name,email,password_hash:await bcrypt.hash(pw,10),role,active:true});
    await mk('owner@pasarmini.id','Pemilik Pasar Mini','owner','Owner#2026');
    await mk('admin@pasarmini.id','Admin Toko','admin','Admin#2026');
    await mk('kasir@pasarmini.id','Kasir Toko','staff','Kasir#2026');
    const cats=[]; for(const n of ['Ayam Potong','Paket Sayur','Bahan Makanan','Retail']) cats.push(await db.insert('categories',{name:n}));
    const cid=n=>cats.find(c=>c.name===n).id;
    const P=[
      {sku:'AYM-KMP-1KG',name:'Ayam Kampung Potong 1kg',category_id:cid('Ayam Potong'),unit:'kg',buy_price:35000,sell_price:48000,stock:25,min_stock:5,perishable:true,expiry_days:1},
      {sku:'AYM-NBG-1KG',name:'Ayam Negeri Potong 1kg',category_id:cid('Ayam Potong'),unit:'kg',buy_price:22000,sell_price:32000,stock:40,min_stock:10,perishable:true,expiry_days:1},
      {sku:'PKG-SYR-A',name:'Paket Sayur A',category_id:cid('Paket Sayur'),unit:'pack',buy_price:9000,sell_price:14000,stock:30,min_stock:8,perishable:true,expiry_days:2},
      {sku:'BHN-BWS-1KG',name:'Bawang Merah 1kg',category_id:cid('Bahan Makanan'),unit:'kg',buy_price:28000,sell_price:38000,stock:18,min_stock:4},
      {sku:'BHN-TMP-1P',name:'Tempe 1 papan',category_id:cid('Bahan Makanan'),unit:'pcs',buy_price:5000,sell_price:8000,stock:25,min_stock:6,perishable:true,expiry_days:3},
      {sku:'RTL-BER-5KG',name:'Beras Premium 5kg',category_id:cid('Retail'),unit:'pack',buy_price:62000,sell_price:75000,stock:20,min_stock:5},
      {sku:'RTL-MIG-1D',name:'Mie Instan (dus isi 40)',category_id:cid('Retail'),unit:'pack',buy_price:95000,sell_price:115000,stock:10,min_stock:3},
      {sku:'RTL-GLA-1KG',name:'Gula Pasir 1kg',category_id:cid('Retail'),unit:'kg',buy_price:14000,sell_price:18000,stock:30,min_stock:8},
    ];
    for(const p of P) await db.insert('products',p);
    await db.insert('suppliers',{name:'Poultry Jaya',phone:'0812-3456-7890'});
    await db.insert('customers',{name:'Ibu Sari',phone:'0857-7777-8888'});
    await acc.post(db,{date:new Date().toISOString().slice(0,10),refType:'adjustment',refId:null,description:'Setoran modal awal',userId:null,
      lines:[{account:'Kas',debit:5000000,credit:0},{account:'Modal Pemilik',debit:0,credit:5000000}]});
    db.flush&&db.flush();
  }
  const {createApp}=require('../src/app');
  const http=require('http'); const app=createApp();
  const srv=http.createServer(app); await new Promise(r=>srv.listen(0,r));
  const base='http://127.0.0.1:'+srv.address().port;
  const J=async(p,o={})=>{const h={...(o.headers||{})};if(global.TOKEN)h.Authorization='Bearer '+global.TOKEN;
    if(o.body&&!Array.isArray(o.body)&&!(o.body instanceof URLSearchParams)) o.body=JSON.stringify(o.body),h['Content-Type']='application/json';
    else if(o.body) h['Content-Type']='application/x-www-form-urlencoded';
    return await new Promise((res,rej)=>{const u=new URL(base+p);const rq=require('http').request({hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:o.method||'GET',headers:h},rs=>{let b='';rs.setEncoding('utf8');rs.on('data',c=>b+=c);rs.on('end',()=>res({status:rs.statusCode,body:(()=>{try{return JSON.parse(b);}catch{return b;}})(),raw:b}));});rq.on('error',rej);rq.end(typeof o.body==='string'?o.body:(o.body instanceof URLSearchParams?o.body.toString():undefined));});};

  test('health',async()=>{const r=await J('/api/health');assert.equal(r.status,200);assert.equal(r.body.ok,true);});
  test('login salah -> 401',async()=>{const r=await J('/api/auth/login',{method:'POST',body:{email:'owner@pasarmini.id',password:'salahsekali'}});assert.equal(r.status,401);});
  test('login owner ok',async()=>{const r=await J('/api/auth/login',{method:'POST',body:{email:'owner@pasarmini.id',password:'Owner#2026'}});
    assert.equal(r.status,200);assert.ok(r.body.token);global.TOKEN=r.body.token;});
  test('tanpa token -> 401',async()=>{const t=global.TOKEN;global.TOKEN=null;const r=await J('/api/products');global.TOKEN=t;assert.equal(r.status,401);});
  test('staff tidak boleh buat produk (RBAC)',async()=>{
    const l=await J('/api/auth/login',{method:'POST',body:{email:'kasir@pasarmini.id',password:'Kasir#2026'}});
    const t=l.body.token; global.TOKEN=t; const r=await J('/api/products',{method:'POST',body:{sku:'X-1',name:'Coba',buy_price:1,sell_price:2}});
    assert.equal(r.status,403); global.TOKEN=process.env._owner||t; });
  test('kembali sebagai owner',async()=>{const r=await J('/api/auth/login',{method:'POST',body:{email:'owner@pasarmini.id',password:'Owner#2026'}});global.TOKEN=r.body.token;assert.equal(r.status,200);});
  test('buat penjualan mengurangi stok & membuk jurnal',async()=>{
    const db=getDb(); const p=(await db.all('products',{})).find(x=>x.sku==='AYM-NBG-1KG');
    const before=+p.stock;
    const r=await J('/api/sales',{method:'POST',body:{items:[{product_id:p.id,qty:2}],paymentMethod:'cash'}});
    assert.equal(r.status,201); assert.equal(r.body.total, +(2*p.sell_price).toFixed(2));
    const after=+(await db.find('products',{id:p.id})).stock; assert.equal(after, before-2);
    const j=await J('/api/reports/summary'); assert.ok(j.body.revenue>=r.body.total);});
  test('penjualan melebihi stok -> 409',async()=>{
    const db=getDb(); const p=(await db.all('products',{})).find(x=>x.sku==='RTL-MIG-1D');
    const r=await J('/api/sales',{method:'POST',body:{items:[{product_id:p.id,qty:9999}],paymentMethod:'cash'}});
    assert.equal(r.status,409);});
  test('pembelian menaikkan stok + rata-rata biaya',async()=>{
    const db=getDb(); const p=(await db.all('products',{})).find(x=>x.sku==='RTL-GLA-1KG');
    const before=+p.stock, costBefore=+p.buy_price;
    const r=await J('/api/purchases',{method:'POST',body:{items:[{product_id:p.id,qty:10,unit_price:20000}],paymentMethod:'cash'}});
    assert.equal(r.status,201);
    const after=await db.find('products',{id:p.id});
    assert.equal(+after.stock, before+10);
    assert.ok(+after.buy_price>costBefore && +after.buy_price<20000, 'harga rata-rata bergerak ke arah 20000');});
  test('pembelian kredit mencatat utang lalu bayar',async()=>{
    const db=getDb(); const p=(await db.all('products',{})).find(x=>x.sku==='RTL-BER-5KG');
    const r=await J('/api/purchases',{method:'POST',body:{items:[{product_id:p.id,qty:5,unit_price:60000}],paymentMethod:'credit'}});
    assert.equal(r.status,201); assert.equal(+r.body.paid,0);
    const pay=await J(`/api/purchases/${r.body.id}/pay`,{method:'POST',body:{amount:100000}});
    assert.equal(pay.status,200); assert.equal(+pay.body.paid,100000);});
  test('OCR struk internal -> parsed benar',async()=>{
    const text=['TOPO GROSIR SAYUR','Jl. Merdeka No 5','Tanggal: 25/09/2026','','AYAM KAMPUNG 2 15.000 30.000','SAWI HIJAU x5 4.000 20.000','','TOTAL: 50.000','TUNAI: 100.000','KEMBALI: 50.000'].join('\n');
    const fd=new URLSearchParams(); fd.append('raw_text',text);
    const r=await J('/api/receipts/upload',{method:'POST',body:fd});
    assert.equal(r.status,201,'upload harus 201, dapat '+r.status+': '+JSON.stringify(r.body).slice(0,300)); const p=r.body.parsed;
    assert.equal(p.date,'2026-09-25'); assert.equal(p.total,50000);
    assert.ok(p.items.length>=2,'item terdeteksi: '+JSON.stringify(p.items));
    const ayam=p.items.find(i=>/AYAM/.test(i.name)); assert.ok(ayam); assert.equal(ayam.line_total,30000);
    global.RECID=r.body.id;});
  test('konfirmasi OCR -> pembelian + stok naik',async()=>{
    const db=getDb(); const p=(await db.all('products',{})).find(x=>x.sku==='AYM-KMP-1KG');
    const before=+p.stock;
    const r=await J(`/api/receipts/${global.RECID}/confirm`,{method:'POST',body:{parsed:{date:'2026-09-25',items:[{product_id:p.id,qty:2,unit_price:15000}]},payment_method:'cash'}});
    assert.equal(r.status,200); assert.equal(r.body.purchase.code.slice(0,3),'PO-');
    assert.equal(+(await db.find('products',{id:p.id})).stock, before+2);});
  test('aset: catat, depresiasi, jual',async()=>{
    const a=await J('/api/assets',{method:'POST',body:{name:'Kulkiner Display',purchase_price:4800000,usefulLifeMonths:48,purchaseDate:'2026-01-10'}});
    assert.equal(a.status,201,'gagal catat aset: '+JSON.stringify(a.body).slice(0,300));
    const list=await J('/api/assets'); const row=list.body.find(x=>x.id===a.body.id);
    assert.ok(row,'aset tidak muncul di daftar');
    assert.equal(row.monthly_dep,100000,'monthly_dep salah: '+JSON.stringify(row).slice(0,300));
    assert.ok(row.book_value<4800000&&row.book_value>4000000,'book_value di luar rentang: '+row.book_value);
    const s=await J(`/api/assets/${a.body.id}/sell`,{method:'POST',body:{sold_price:3000000}});
    assert.equal(s.status,200); assert.equal(s.body.status,'sold');});
  test('beban & pendapatan lain',async()=>{
    const e=await J('/api/finance/expenses',{method:'POST',body:{category:'Listrik',amount:250000}});assert.equal(e.status,201);
    const i=await J('/api/finance/incomes',{method:'POST',body:{category:'Jasa Tisu',amount:50000}});assert.equal(i.status,201);});
  test('laporan konsistensi laba',async()=>{
    const pl=await J('/api/reports/profit-loss');const b=pl.body;
    assert.ok(Math.abs(b.gross_profit-(b.revenue-b.cogs))<1);
    assert.ok(Math.abs(b.net_profit-(b.gross_profit-b.expenses+b.other_income))<1);});
  test('neraca tersedia',async()=>{const bs=await J('/api/reports/balance-sheet');assert.equal(bs.status,200);assert.ok('total_assets'in bs.body);});
  test('ekspor PDF laba rugi',async()=>{
    const r=await new Promise((res,rej)=>{const rq=require('http').request(base+'/api/reports/profit-loss.pdf?token='+global.TOKEN,{method:'GET',headers:{Authorization:'Bearer '+global.TOKEN}},rs=>{let chunks=[];rs.on('data',c=>chunks.push(c));rs.on('end',()=>res({status:rs.statusCode,buf:Buffer.concat(chunks)}));});rq.on('error',rej);rq.end();});
    assert.equal(r.status,200);
    assert.equal(r.buf.slice(0,4).toString(),'%PDF');});
  test('void penjualan mengembalikan stok',async()=>{
    const db=getDb(); const p=(await db.all('products',{})).find(x=>x.sku==='BHN-TMP-1L'||x.sku==='BHN-TMP-1P'||x.sku.startsWith('BHN-TMP'));
    const r=await J('/api/sales',{method:'POST',body:{items:[{product_id:p.id,qty:3}],paymentMethod:'cash'}});
    const mid=+(await db.find('products',{id:p.id})).stock;
    const v=await J(`/api/sales/${r.body.id}/void`,{method:'POST'}); assert.equal(v.status,200);
    assert.equal(+(await db.find('products',{id:p.id})).stock, mid+3);});
  test('rate limit login',async()=>{
    global.TOKEN=null; let last, firstOk=null;
    for(let i=0;i<12;i++){ last=await J('/api/auth/login',{method:'POST',body:{email:'x@x.x',password:'xxxxxxxxxx'}}); if(!firstOk&&last.status===429) firstOk=i+1; }
    assert.equal(last.status,429,'setelah >10 percobaan gagal harus 429 (dapat '+last.status+')');
    // Setelah terpicu, kunci berlaku sementara lalu pulih sendiri (window 60 detik).
    await new Promise(r=>setTimeout(r,62000));
    const l=await J('/api/auth/login',{method:'POST',body:{email:'admin@pasarmini.id',password:'Admin#2026'}});
    assert.equal(l.status,200,'login valid setelah jendela rate-limit harus berhasil: '+JSON.stringify(l.body).slice(0,200));
    global.TOKEN=l.body.token||global.TOKEN;});
  test('logout mencabut sesi',async()=>{
    const l=await J('/api/auth/login',{method:'POST',body:{email:'owner@pasarmini.id',password:'Owner#2026'}});
    global.TOKEN=l.body.token; const me=await J('/api/auth/me'); assert.equal(me.status,200);
    await J('/api/auth/logout',{method:'POST'}); const me2=await J('/api/auth/me'); assert.equal(me2.status,401);});
};
main().then(async()=>{
  for(const c of _cases){
    try{ await c.fn(); console.log('ok  -',c.name); }
    catch(e){ console.log('FAIL-',c.name,'::',(e&&e.message)||e); process.exitCode=1; }
  }
  process.exit(process.exitCode||0);
}).catch(e=>{console.error(e);process.exit(1);});
