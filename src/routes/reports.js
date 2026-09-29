'use strict';
const ex=require('express'); const getDb=require('../db'); const A=require('../middleware/auth');
const rep=require('../services/reports'); const PDFDocument=require('pdfkit');
const r=ex.Router(); r.use(A.requireAuth);
const F=q=>({from:q.from,to:q.to});

r.get('/summary',async(req,res,next)=>{try{res.json(await rep.summary(getDb(),F(req.query)));}catch(e){next(e);}});
r.get('/daily',async(req,res,next)=>{try{res.json(await rep.daily(getDb(),F(req.query)));}catch(e){next(e);}});
r.get('/by-product',async(req,res,next)=>{try{res.json(await rep.byProduct(getDb(),F(req.query)));}catch(e){next(e);}});
r.get('/by-category',async(req,res,next)=>{try{res.json(await rep.byCategory(getDb(),F(req.query)));}catch(e){next(e);}});
r.get('/top-products',async(req,res,next)=>{try{res.json(await rep.topProducts(getDb(),F(req.query)));}catch(e){next(e);}});
r.get('/slow-moving',async(req,res,next)=>{try{res.json(await rep.slowMoving(getDb(),F(req.query)));}catch(e){next(e);}});
r.get('/inventory-valuation',async(req,res,next)=>{try{res.json(await rep.inventoryValuation(getDb()));}catch(e){next(e);}});
r.get('/profit-loss',async(req,res,next)=>{try{res.json(await rep.profitLoss(getDb(),F(req.query)));}catch(e){next(e);}});
r.get('/balance-sheet',async(req,res,next)=>{try{res.json(await rep.balanceSheet(getDb()));}catch(e){next(e);}});

/** Ekspor PDF laporan laba-rugi. */
r.get('/profit-loss.pdf',async(req,res,next)=>{
  try{
    const pl=await rep.profitLoss(getDb(),F(req.query));
    res.setHeader('Content-Type','application/pdf');
    const doc=new PDFDocument({margin:50}); doc.pipe(res);
    const rp=n=>'Rp '+Number(n||0).toLocaleString('id-ID');
    doc.fontSize(18).text('PASAR MINI - Laporan Laba Rugi',{align:'center'});
    doc.fontSize(10).text(`Periode: ${req.query.from||'awal'} s/d ${req.query.to||'sekarang'}`,{align:'center'});
    doc.moveDown();
    const row=(l,v,b)=>{doc.fontSize(b?12:11).text(l+' :  '+rp(v),{continued:false});};
    row('Pendapatan Penjualan',pl.revenue); row('HPP',-pl.cogs); doc.text('- HPP : '+rp(pl.cogs));
    row('Laba Kotor',pl.gross_profit,true); doc.moveDown(0.4);
    for(const e of pl.expense_breakdown) doc.text('- Beban '+e.category+' : '+rp(e.amount));
    doc.text('+ Pendapatan Lain : '+rp(pl.other_income));
    row('Laba Bersih',pl.net_profit,true);
    doc.end();
  }catch(e){next(e);}
});
module.exports=r;
