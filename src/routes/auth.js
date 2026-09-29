'use strict';
const ex=require('express'), bcrypt=require('bcryptjs');
const getDb=require('../db'); const A=require('../middleware/auth');
const r=ex.Router();

r.post('/login',A.rateLimit({windowMs:60000,max:10}),async(req,res,next)=>{
  try{
    const {email,password}=req.body||{};
    if(!email||!password) return res.status(400).json({error:'Email & password wajib'});
    const db=getDb();
    const u=await db.find('users',{email:String(email).toLowerCase()});
    if(!u||!(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Kredensial salah'});
    if(u.active===false) return res.status(403).json({error:'Akun dinonaktifkan'});
    const token=A.sign(u); const payload=require('jsonwebtoken').decode(token);
    await A.storeSession(payload.jti,u.id,7);
    res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role}});
  }catch(e){next(e);}
});
r.post('/logout',A.requireAuth,async(req,res,next)=>{try{
  // Cabut sesi aktif (jti) saja — bukan seluruh sesi pengguna, agar login ganda
  // (mis. beberapa perangkat / uji berurutan dengan akun sama) tidak saling mencabut.
  await A.revoke(req.token.jti,false); res.json({ok:true}); }catch(e){next(e);}});
r.get('/me',A.requireAuth,(req,res)=>res.json({id:req.user.id,name:req.user.name,email:req.user.email,role:req.user.role}));

// Manajemen pengguna (owner/admin)
r.get('/users',A.requireAuth,A.requireRole('owner','admin'),async(req,res,next)=>{
  try{ const db=getDb(); const us=await db.all('users',{},{orderBy:{id:'asc'}}); res.json(us.map(({password_hash,...u})=>u)); }catch(e){next(e);}
});
r.post('/users',A.requireAuth,A.requireRole('owner'),async(req,res,next)=>{
  try{
    const {name,email,password,role='staff'}=req.body||{};
    if(!name||!email||!password||password.length<8) return res.status(400).json({error:'Data tidak valid (password min 8 karakter)'});
    if(!['owner','admin','staff'].includes(role)) return res.status(400).json({error:'Role tidak valid'});
    const db=getDb();
    if(await db.find('users',{email:String(email).toLowerCase()})) return res.status(409).json({error:'Email sudah terdaftar'});
    const hash=await bcrypt.hash(password,10);
    const u=await db.insert('users',{name,email:String(email).toLowerCase(),password_hash:hash,role,active:true});
    delete u.password_hash; res.status(201).json(u);
  }catch(e){next(e);}
});
r.patch('/users/:id',A.requireAuth,A.requireRole('owner'),async(req,res,next)=>{
  try{ const db=getDb(); const patch={}; for(const k of ['name','role','active']) if(req.body[k]!==undefined) patch[k]=req.body[k];
    if(req.body.password){ if(String(req.body.password).length<8) return res.status(400).json({error:'Password min 8 karakter'});
      patch.password_hash=await bcrypt.hash(req.body.password,10); }
    const n=await db.update('users',{id:+req.params.id},patch); res.json({updated:n}); }catch(e){next(e);}
});
module.exports=r;
