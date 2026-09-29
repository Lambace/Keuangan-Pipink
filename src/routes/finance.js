'use strict';
const ex=require('express'); const getDb=require('../db'); const A=require('../middleware/auth');
const acc=require('../services/accounting');
const r=ex.Router(); r.use(A.requireAuth);

r.get('/accounts',async(req,res,next)=>{try{res.json(await acc.balances(getDb()));}catch(e){next(e);}});
r.get('/journal',async(req,res,next)=>{try{const db=getDb();
  let es=await db.all('journal_entries',{orderBy:{id:'desc'}});
  if(req.query.from) es=es.filter(x=>String(x.date)>=req.query.from);
  if(req.query.to) es=es.filter(x=>String(x.date)<=req.query.to);
  for(const e of es) e.lines=await db.all('ledger',{entry_id:e.id});
  res.json(es.slice(0,500));}catch(e){next(e);}});

r.post('/expenses',async(req,res,next)=>{try{const db=getDb();
  const b=req.body||{}; if(!(+b.amount>0)||!b.category) return res.status(400).json({error:'category & amount wajib'});
  return db.tx(async(t)=>{
    const e=await t.insert('expenses',{date:b.date||new Date().toISOString().slice(0,10),category:b.category,amount:+b.amount,
      payment_method:b.payment_method||'cash',description:b.description||null,created_by:req.user.id});
    await acc.post(t,{date:e.date,refType:'expense',refId:e.id,description:'Beban: '+b.category,userId:req.user.id,
      lines:[{account:'Beban Operasional',debit:+b.amount,credit:0},{account:b.payment_method==='transfer'?'Bank':'Kas',debit:0,credit:+b.amount}]});
    res.status(201).json(e);});}catch(e){next(e);}});

r.post('/incomes',async(req,res,next)=>{try{const db=getDb();
  const b=req.body||{}; if(!(+b.amount>0)||!b.category) return res.status(400).json({error:'category & amount wajib'});
  return db.tx(async(t)=>{
    const e=await t.insert('incomes',{date:b.date||new Date().toISOString().slice(0,10),category:b.category,amount:+b.amount,
      payment_method:b.payment_method||'cash',description:b.description||null,created_by:req.user.id});
    await acc.post(t,{date:e.date,refType:'income',refId:e.id,description:'Pendapatan lain: '+b.category,userId:req.user.id,
      lines:[{account:b.payment_method==='transfer'?'Bank':'Kas',debit:+b.amount,credit:0},{account:'Pendapatan Lain',debit:0,credit:+b.amount}]});
    res.status(201).json(e);});}catch(e){next(e);}});

r.get('/expenses',async(req,res,next)=>{try{res.json(await getDb().all('expenses',{orderBy:{id:'desc'}}));}catch(e){next(e);}});
r.get('/incomes',async(req,res,next)=>{try{res.json(await getDb().all('incomes',{orderBy:{id:'desc'}}));}catch(e){next(e);}});
module.exports=r;
