'use strict';
/**
 * Engine penyimpanan internal PASAR MINI.
 * - Persisten ke ./data/db.json (write-through, debounce 50ms).
 * - Transaksi: snapshot/rollback. Kunci async per-proses mencegah race condition.
 * - API kompatibel dengan modul pg.ts (insert/update/del/all/find/exec/tx).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const TABLES = ['users','categories','suppliers','customers','products','accounts',
  'journal_entries','ledger','sales','sale_items','purchases','purchase_items',
  'expenses','incomes','assets','stock_movements','receipts','audit_logs','sessions'];

/** Lokasi file data: PM_DATA_DIR utk test/instance terpisah, default ./data. */
const DIR = process.env.PM_DATA_DIR || config.state.dataDir || path.join(__dirname,'../../data');
fs.mkdirSync(DIR,{recursive:true});
const FILE = path.join(DIR, 'db.json');
let data;
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch { data = {}; }
for (const t of TABLES) if (!Array.isArray(data[t])) data[t] = [];
if (!data._seq) data._seq = {};
for (const t of TABLES) if (!data._seq[t]) data._seq[t] = data[t].reduce((m,r)=>Math.max(m,+r.id||0),0);

let dirty = false, timer = null;
function persistNow(){ if(timer){clearTimeout(timer);timer=null;} fs.writeFileSync(FILE+'.tmp',JSON.stringify(data)); fs.renameSync(FILE+'.tmp',FILE); dirty=false; }
function markDirty(){ dirty=true; if(!timer) timer=setTimeout(()=>{timer=null; if(dirty)persistNow();},50); }
process.on('exit', ()=>{ try { if(dirty) persistNow(); } catch {} });
function flush(){ if(dirty) persistNow(); }

function nextId(t){ data._seq[t]=(data._seq[t]||0)+1; return data._seq[t]; }
const nowIso = () => new Date().toISOString();

function match(row, where){
  for (const k in where){
    let w = where[k];
    if (w && typeof w==='object' && w.__op==='like'){ if(!String(row[k]??'').toLowerCase().includes(w.v.toLowerCase())) return false; continue; }
    if (w && typeof w==='object' && w.__op==='in'){ if(!w.v.map(String).includes(String(row[k]))) return false; continue; }
    if (w===null){ if(row[k]!=null) return false; continue; }
    if (String(row[k])!==String(w)) return false;
  }
  return true;
}

// simple lock queue
let chain = Promise.resolve();
function enqueue(fn){ chain = chain.then(fn,fn); return chain; }

const api = {
  engine: 'file',
  flush,
  all(table, opts={}){
    let rows = data[table].filter(r=>match(r, opts.where||{}));
    if (opts.orderBy){ const [k,dir]=[Object.entries(opts.orderBy)[0]]; rows=[...rows].sort((a,b)=>(a[k]>b[k]?1:-1)*(dir==='desc'?-1:1)); }
    if (opts.limit!=null) rows = rows.slice(opts.offset||0, (opts.offset||0)+opts.limit);
    return Promise.resolve(rows.map(r=>({...r})));
  },
  find(table, where, opts={}){ return api.all(table,{...opts, where, limit:1}).then(rs=>rs[0]||null); },
  insert(table, row){
    row = {...row};
    if(!Array.isArray(data[table])) data[table]=[];
    if(row.id==null) row.id = nextId(table); else data._seq[table]=Math.max(data._seq[table]||0,row.id);
    if(!row.created_at) row.created_at = nowIso();
    data[table].push(row); markDirty();
    return Promise.resolve({...row});
  },
  update(table, where, patch){
    let n=0;
    if(!Array.isArray(data[table])) data[table]=[];
    for(const r of data[table]) if(match(r,where)){ Object.assign(r,patch,{updated_at:nowIso()}); n++; }
    markDirty(); return Promise.resolve(n);
  },
  del(table, where){
    if(!Array.isArray(data[table])) data[table]=[];
    const before=data[table].length;
    data[table]=data[table].filter(r=>!match(r,where));
    markDirty(); return Promise.resolve(before-data[table].length);
  },
  count(table, where={}){ return api.all(table,{where}).then(r=>r.length); },
  /** tx(fn): fn menerima transaksi dengan rollback otomatis pada error. */
  tx(fn){
    return enqueue(async()=>{
      const snap = JSON.stringify({ tables: TABLES.map(t=>data[t]), seq: data._seq });
      try { const out = await fn(api); flush(); return out; }
      catch(e){ const s=JSON.parse(snap); TABLES.forEach((t,i)=>data[t]=s.tables[i]); data._seq=s.seq; throw e; }
    });
  },
  _raw: ()=>data,
};
module.exports = api;
