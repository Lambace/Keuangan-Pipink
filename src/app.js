'use strict';
const express=require('express'), helmet=require('helmet'), cookieParser=require('cookie-parser');
const path=require('path');
function createApp(){
  const app=express();
  app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'cross-origin'}}));
  app.use(express.json({limit:'2mb'}));
  app.use(express.urlencoded({extended:true,limit:'2mb'})); // form-urlencoded (mis. raw_text OCR dari klien non-JSON)
  app.use(cookieParser());
  app.disable('x-powered-by');

  app.get('/api/health',(req,res)=>res.json({ok:true,app:'PASAR MINI',engine:require('../src/config').state.mode,time:new Date().toISOString()}));
  app.use('/api/auth',require('./routes/auth'));
  app.use('/api',require('./routes/crm'));
  app.use('/api/products',require('./routes/products'));
  app.use('/api/sales',require('./routes/sales'));
  app.use('/api/purchases',require('./routes/purchases'));
  app.use('/api/finance',require('./routes/finance'));
  app.use('/api/assets',require('./routes/assets'));
  app.use('/api/reports',require('./routes/reports'));
  app.use('/api/receipts',require('./routes/receipts'));

  app.use(express.static(path.join(__dirname,'..','public')));
  app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));

  // error handler terpusat (tanpa bocorkan stack di produksi)
  app.use((err,req,res,next)=>{
    if(res.headersSent) return next(err);
    const status=err.status||(err.type==='entity.too.large'?413:500);
    if(status>=500) console.error('[error]',err.message);
    res.status(status).json({error:status>=500?'Terjadi kesalahan internal':err.message});
  });
  return app;
}
module.exports={createApp};
