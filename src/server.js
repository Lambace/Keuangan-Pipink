'use strict';
const config=require('./config');
(async()=>{
  await config.init();
  const getDb=require('./db'); const acc=require('./services/accounting');
  const db=getDb(); await acc.ensureAccounts(db);
  if(config.state.mode==='pg'){ /* migrate otomatis */ }
  const {createApp}=require('./app');
  const app=createApp();
  app.listen(config.state.port,()=>console.log(`PASAR MINI berjalan di http://localhost:${config.state.port} (storage: ${config.state.mode})`));
})().catch(e=>{console.error('Gagal start:',e);process.exit(1);});
