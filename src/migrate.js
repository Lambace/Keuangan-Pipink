'use strict';
/** Jalankan skema PostgreSQL dari migrations/*.sql. */
const fs=require('fs'),path=require('path');
(async()=>{
  const config=require('./config'); await config.init();
  if(config.state.mode!=='db'){ console.log('Mode file aktif - skema PostgreSQL tidak diperlukan. Untuk produksi: set DATABASE_URL & DB_MODE=db'); process.exit(0);}
  const pg=require('./db/pg');
  const dir=path.join(__dirname,'..','migrations');
  for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort()){
    console.log('Migrasi:',f); await pg.pool.query(fs.readFileSync(path.join(dir,f),'utf8'));
  }
  console.log('Migrasi selesai.'); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
