'use strict';
const jwt=require('jsonwebtoken'), crypto=require('crypto');
const config=require('../config');
const getDb=require('../db');

/** Rate-limit login (per-IP) — in-memory + Redis bila tersedia.
 *  Percobaan dengan kredensial yang BENAR tidak dihitung terhadap kuota, sehingga
 *  pengguna sah tidak terkunci oleh serangan brute-force dari IP yang sama. */
const buckets=new Map();
async function validCred(email,password){
  try{
    const db=getDb();
    const u=await db.find('users',{email:String(email||'').toLowerCase()});
    return !!(u && await bcrypt.compare(String(password||''), u.password_hash));
  }catch(e){ return false; }
}
function rateLimit({windowMs=60000,max=10}={}){
  return async (req,res,next)=>{
    try{
      const key=(req.ip||'')+'|'+req.path; const now=Date.now();
      let arr=(buckets.get(key)||[]).filter(t=>now-t<windowMs);
      const {email,password}=req.body||{};
      if(!(await validCred(email,password))){ // hanya hitung sebagai percobaan gagal
        if(arr.length>=max) return res.status(429).json({error:'Terlalu banyak percobaan, coba lagi nanti.'});
        arr.push(now);
      }
      buckets.set(key,arr); next();
    }catch(e){ next(e); }
  };
}
function sign(user){
  const jti=crypto.randomUUID();
  return jwt.sign({sub:user.id,role:user.role,name:user.name,jti},config.state.jwtSecret,{expiresIn:config.state.jwtDays+'d'});
}
async function requireAuth(req,res,next){
  try{
    let token=req.headers.authorization?.replace(/^Bearer /i,'');
    if(!token&&req.query.token) token=String(req.query.token); // utk tautan unduhan PDF/CSV browser
    if(!token&&req.headers.cookie) token=parseCookie(req.headers.cookie).pm_token;
    if(!token) return res.status(401).json({error:'Autentikasi diperlukan'});
    const payload=jwt.verify(token,config.state.jwtSecret);
    const db=getDb();
    // cek sesi (whitelist) - di mode file/pg keduanya punya tabel sessions
    if(db.engine==='pg'){
      const r=await db.pool.query('SELECT * FROM sessions WHERE jti=$1 AND expires_at>now()',[payload.jti]);
      if(!r.rowCount) return res.status(401).json({error:'Sesi tidak valid / telah dicabut'});
    } else {
      const s=await db.find('sessions',{jti:payload.jti});
      if(!s||new Date(s.expires_at)<new Date()) return res.status(401).json({error:'Sesi tidak valid / telah dicabut'});
    }
    const user=await db.find('users',{id:payload.sub});
    if(!user||user.active===false) return res.status(401).json({error:'Akun tidak aktif'});
    req.user=user; req.token=payload; next();
  }catch(e){ return res.status(401).json({error:'Token tidak valid'}); }
}
function parseCookie(h){ const o={}; (h||'').split(';').forEach(p=>{const [k,...v]=p.trim().split('=');o[k]=decodeURIComponent(v.join('='));}); return o; }
function requireRole(...roles){ return (req,res,next)=> roles.includes(req.user.role)?next():res.status(403).json({error:'Akses ditolak (butuh role: '+roles.join('/')+')'}); }
/** Cabut satu sesi (jti) atau seluruh sesi milik user (all=true) — untuk logout. */
async function revoke(jtiOrUserId,all=false){
  const db=getDb();
  if(all){ // cabut seluruh sesi milik pengguna
    if(db.engine==='pg') await db.pool.query('DELETE FROM sessions WHERE user_id=$1',[jtiOrUserId]);
    else await db.del('sessions',{user_id:jtiOrUserId});
  }else{
    if(db.engine==='pg') await db.pool.query('DELETE FROM sessions WHERE jti=$1',[jtiOrUserId]);
    else await db.del('sessions',{jti:jtiOrUserId});
  }
}
/** Simpan sesi; jika jti sudah ada (login ganda dalam 1 detik), geser masa berlaku agar sesi lama tidak ikut tercabut. */
async function storeSession(jti,userId,days){
  const db=getDb(); let exp=new Date(Date.now()+days*864e5).toISOString();
  if(db.engine==='pg'){
    await db.pool.query('INSERT INTO sessions(jti,user_id,expires_at) VALUES($1,$2,$3) ON CONFLICT (jti) DO UPDATE SET expires_at=GREATEST(sessions.expires_at,EXCLUDED.expires_at)',[jti,userId,exp]);
  } else {
    const ex=await db.find('sessions',{jti});
    if(ex&&new Date(ex.expires_at)>=new Date(exp)) exp=new Date(Math.max(Date.now()+days*864e5,new Date(ex.expires_at).getTime()+1000)).toISOString();
    if(ex) await db.update('sessions',{jti},{expires_at:exp});
    else await db.insert('sessions',{jti,user_id:userId,expires_at:exp});
  }
}
module.exports={sign,requireAuth,requireRole,rateLimit,revoke,storeSession,parseCookie};
