'use strict';
/**
 * Buku besar double-entry PASAR MINI.
 * Aturan saldo: debit-normal = cash,bank,cogs,expense,receivable; kredit-normal = lainnya.
 */
const CHART = [
  { name:'Kas', type:'cash' }, { name:'Bank', type:'bank' },
  { name:'Persediaan', type:'inventory' },
  { name:'Pi Dagang', type:'receivable' }, { name:'Utang Dagang', type:'payable' },
  { name:'Aset Tetap', type:'asset' }, { name:'Akum Depresiasi', type:'contra_asset' },
  { name:'Modal Pemilik', type:'equity' }, { name:'Laba Ditahan', type:'equity' },
  { name:'Pendapatan Penjualan', type:'revenue' },
  { name:'Pendapatan Lain', type:'revenue' }, { name:'Beban Pokok (HPP)', type:'cogs' },
  { name:'Beban Operasional', type:'expense' }, { name:'Beban Depresiasi', type:'expense' },
  { name:'Keuntungan Penjualan Aset', type:'revenue' }, { name:'Kerugian Penjualan Aset', type:'expense' },
];
const DEBIT_NORMAL = new Set(['cash','bank','inventory','asset','cogs','expense','receivable']);

async function ensureAccounts(db){
  for(const a of CHART){
    const ex = await db.find('accounts',{name:a.name});
    if(!ex) await db.insert('accounts',{...a, balance:0});
    else if(ex.type!==a.type) await db.update('accounts',{id:ex.id},{type:a.type}); // migrasi tipe akun lama
  }
}
async function acc(db,name){ const a=await db.find('accounts',{name}); if(!a) throw new Error('Akun tidak ditemukan: '+name); return a; }
function signed(type,d,c){ return DEBIT_NORMAL.has(type)? (+d - +c) : (+c - +d); }

/** posting: [{account, debit, credit}] — harus balance. */
async function post(db,{date,refType,refId,description,userId,lines}){
  const d=+lines.reduce((s,l)=>s+(+l.debit||0),0), c=+lines.reduce((s,l)=>s+(+l.credit||0),0);
  if(Math.abs(d-c)>0.011) throw new Error('Jurnal tidak balance (D='+d+' K='+c+')');
  const entry=await db.insert('journal_entries',{date,ref_type:refType,ref_id:refId||null,description,created_by:userId||null});
  for(const l of lines){
    const a=await acc(db,l.account);
    await db.insert('ledger',{entry_id:entry.id,account_id:a.id,debit:+(l.debit||0).toFixed(2),credit:+(l.credit||0).toFixed(2)});
    const delta=signed(a.type,l.debit||0,l.credit||0);
    await db.update('accounts',{id:a.id},{balance:+(+a.balance+delta).toFixed(2)});
  }
  return entry;
}
async function balances(db){ return db.all('accounts',{}); }
module.exports={ensureAccounts,post,acc,balances,CHART};
