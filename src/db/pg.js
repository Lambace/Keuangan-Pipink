'use strict';
/** Adapter PostgreSQL dengan API identik terhadap engine file. */
const { Pool } = require('pg');
const config = require('../config');
const pool = new Pool({ connectionString: config.state.databaseUrl, max: 10 });

const like = (v)=>({__op:'like',v}); // dipakai di level service, di pg diubah ke ILIKE via query builder khusus

async function all(table, opts={}){
  const where = opts.where||{};
  const cond=[], val=[]; let i=1;
  for(const k in where){
    const w=where[k];
    if(w && typeof w==='object' && w.__op==='like'){ cond.push(`lower(${k}::text) LIKE $${i}`); val.push('%'+String(w.v).toLowerCase()+'%'); i++; continue; }
    if(w && typeof w==='object' && w.__op==='in'){ cond.push(`${k} IN (${w.v.map(()=>{val.push(...w.v);return `$${i++}`;}).join(',')})`); continue; }
    cond.push(`${k} = $${i}`); val.push(w===null?null:String(w)); i++;
  }
  let sql=`SELECT * FROM ${table}`;
  if(cond.length) sql+=' WHERE '+cond.join(' AND ');
  if(opts.orderBy){ const [k,d]=Object.entries(opts.orderBy)[0]; sql+=` ORDER BY ${k} ${d==='desc'?'DESC':'ASC'}`; }
  if(opts.limit!=null) sql+=` LIMIT ${opts.limit} OFFSET ${opts.offset||0}`;
  const r=await pool.query(sql,val); return r.rows;
}
async function find(table, where, opts={}){ const rs=await all(table,{...opts,where,limit:1}); return rs[0]||null; }
async function insert(table,row,c=pool){
  const keys=Object.keys(row); if(!row.created_at && !keys.includes('created_at')) row.created_at=new Date().toISOString();
  const cols=Object.keys(row), vals=cols.map(c=>row[c]);
  const sql=`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`;
  const r=await c.query(sql,vals); return r.rows[0];
}
async function update(table,where,patch,c=pool){
  const ck=Object.keys(patch), wk=Object.keys(where);
  const sets=ck.map((k,i)=>`${k}=$${i+1}`).join(',');
  const conds=wk.map((k,i)=>`${k}=$${ck.length+i+1}`).join(' AND ');
  const sql=`UPDATE ${table} SET ${sets}${conds?` WHERE ${conds}`:''} RETURNING *`;
  const r=await c.query(sql,[...ck.map(k=>patch[k]),...wk.map(k=>where[k])]);
  return r.rowCount;
}
async function del(table,where,c=pool){
  const wk=Object.keys(where);
  const sql=`DELETE FROM ${table}${wk.length?' WHERE '+wk.map((k,i)=>`${k}=$${i+1}`).join(' AND '):''}`;
  const r=await c.query(sql,wk.map(k=>where[k])); return r.rowCount;
}
async function count(table,where={}){ const rs=await all(table,{where}); return rs.length; }
async function tx(fn){
  const c=await pool.connect();
  try{ await c.query('BEGIN');
    const api={all:(t,o)=>all(t,o),find:(t,w,o)=>find(t,w,o),insert:(t,r)=>insert(t,r,c),update:(t,w,p)=>update(t,w,p,c),del:(t,w)=>del(t,w,c),count:(t,w)=>count(t,w),_client:c};
    const out=await fn(api); await c.query('COMMIT'); return out;
  }catch(e){ await c.query('ROLLBACK'); throw e; } finally{ c.release(); }
}
module.exports={engine:'pg',pool,all,find,insert,update,del,count,tx,flush(){},like};
