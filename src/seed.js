'use strict';
/** Data awal: user, kategori, produk (ayam potong, paket sayur, bahan makanan, retail), supplier, pelanggan. */
const bcrypt=require('bcryptjs');
(async()=>{
  const config=require('./config'); await config.init();
  const getDb=require('./db'); const acc=require('./services/accounting');
  const db=getDb(); await acc.ensureAccounts(db);
  if(await db.find('users',{email:'owner@pasarmini.id'})){ console.log('Seed sudah ada, lewati.'); process.exit(0); }
  const mk=async(email,name,role,pw)=>db.insert('users',{name,email,password_hash:await bcrypt.hash(pw,10),role,active:true});
  await mk('owner@pasarmini.id','Pemilik Pasar Mini','owner','Owner#2026');
  await mk('admin@pasarmini.id','Admin Toko','admin','Admin#2026');
  await mk('kasir@pasarmini.id','Kasir Toko','staff','Kasir#2026');
  const cats=[]; for(const n of ['Ayam Potong','Paket Sayur','Bahan Makanan','Retail']) cats.push(await db.insert('categories',{name:n}));
  const id=n=>cats.find(c=>c.name===n).id;
  const P=[
    {sku:'AYM-KMP-1KG',name:'Ayam Kampung Potong 1kg',category_id:id('Ayam Potong'),unit:'kg',buy_price:35000,sell_price:48000,stock:25,min_stock:5,perishable:true,expiry_days:1},
    {sku:'AYM-NBG-1KG',name:'Ayam Negeri Potong 1kg',category_id:id('Ayam Potong'),unit:'kg',buy_price:22000,sell_price:32000,stock:40,min_stock:10,perishable:true,expiry_days:1},
    {SKU:'', sku:'AYM-BRG-1EKR',name:'Ayam Broiler Ekoran',category_id:id('Ayam Potong'),unit:'pcs',buy_price:28000,sell_price:40000,stock:15,min_stock:5,perishable:true,expiry_days:1},
    {sku:'PKG-SYR-A',name:'Paket Sayur A (bayam,kangkung,tomat)',category_id:id('Paket Sayur'),unit:'pack',buy_price:9000,sell_price:14000,stock:30,min_stock:8,perishable:true,expiry_days:2},
    {sku:'PKG-SYR-B',name:'Paket Sayur B (sawi,coli,wortel)',category_id:id('Paket Sayur'),unit:'pack',buy_price:10000,sell_price:16000,stock:20,min_stock:8,perishable:true,expiry_days:2},
    {sku:'BHN-BWS-1KG',name:'Bawang Merah 1kg',category_id:id('Bahan Makanan'),unit:'kg',buy_price:28000,sell_price:38000,stock:18,min_stock:4},
    {sku:'BHN-CBK-1KG',name:'Cabai Rawit 1kg',category_id:id('Bahan Makanan'),unit:'kg',buy_price:40000,sell_price:55000,stock:8,min_stock:3,perishable:true,expiry_days:3},
    {sku:'BHN-TMP-1L',name:'Tempe 1 papan',category_id:id('Bahan Makanan'),unit:'pcs',buy_price:5000,sell_price:8000,stock:25,min_stock:6,perishable:true,expiry_days:3},
    {sku:'RTL-BER-5KG',name:'Beras Premium 5kg',category_id:id('Retail'),unit:'pack',buy_price:62000,sell_price:75000,stock:20,min_stock:5},
    {sku:'RTL-MIG-1D',name:'Mie Instan (dus isi 40)',category_id:id('Retail'),unit:'pack',buy_price:95000,sell_price:115000,stock:10,min_stock:3},
    {sku:'RTL-GLA-1KG',name:'Gula Pasir 1kg',category_id:id('Retail'),unit:'kg',buy_price:14000,sell_price:18000,stock:30,min_stock:8},
    {sku:'RTL-MNY-1L',name:'Minyak Goreng 1L',category_id:id('Retail'),unit:'liter',buy_price:15500,sell_price:19000,stock:24,min_stock:6},
  ];
  for(const p of P) await db.insert('products',p);
  await db.insert('suppliers',{name:'Poultry Jaya (Supplier Ayam)',phone:'0812-3456-7890',address:'Jl. Pasar Rebo No.12'});
  await db.insert('suppliers',{name:'Sayur Segar Makmur',phone:'0813-1111-2222',address:'Jl. Raya Bogor KM 25'});
  await db.insert('customers',{name:'Ibu Sari (Pelanggan Tetap)',phone:'0857-7777-8888'});
  await db.insert('customers',{name:'RM Makan Berkah',phone:'0821-9999-0000',notes:'Pembelian rutin ayam & sayur'});
  // jurnal saldo awal modal
  await acc.post(db,{date:new Date().toISOString().slice(0,10),refType:'adjustment',refId:null,description:'Setoran modal awal',userId:null,
    lines:[{account:'Kas',debit:5000000,credit:0},{account:'Modal Pemilik',debit:0,credit:5000000}]});
  db.flush&&db.flush();
  console.log('Seed selesai. Login: owner@pasarmini.id / Owner#2026');
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
