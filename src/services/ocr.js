'use strict';
/**
 * OCR Struk Pembelian.
 - Engine "google_vision": dipakai bila OCR_API_KEY diisi (Google Cloud Vision REST).
 * - Engine "internal": parser heuristik teks struk Indonesia (offline, tanpa API eksternal) —
 *   mengenali toko/tanggal/grand total & item (nama, qty, harga satuan/jumlah).
 */
const config=require('../config');

function parseNumber(s){
  if(s==null) return null;
  s=String(s).trim();
  // Rupiah: 12.500 / 12,500.00 / 12500
  if(/^\d{1,3}(\.\d{3})+$/.test(s.replace(/[^\d.]/g,''))) return +s.replace(/[^\d]/g,'');
  if(/^\d{1,3}(,\d{3})+(\.\d{2})?$/.test(s)) return +s.replace(/[^\d.]/g,'').replace(/\.(?=\d{3}\b)/g,'');
  const n=s.replace(/[^\d,.-]/g,'');
  if(!n) return null;
  if(/,\d{1,2}$/.test(n)) return +n.replace(/\./g,'').replace(',','.');
  return +n.replace(/[.,]/g,'');
}

function extractTotal(lines){
  let grand=null;
  // Urutan prioritas: "grand total" > "total/jumlah/bayar" (bukan subtotal) > "subtotal".
  const PATTERNS=[
    /grand\s*total\s*[:\-]?\s*(?:Rp\.?\s*)?([\d][\d.,]*)/i,
    /(?:^|\s)(?:total|jumlah)\s*(?:semua|harga|belanja|pembayaran|transaksi)?\s*[:\-]?\s*(?:Rp\.?\s*)?([\d][\d.,]*)/i,
    /bayar\s*[:\-]?\s*(?:Rp\.?\s*)?([\d][\d.,]*)/i,
    /sub\s*total\s*[:\-]?\s*(?:Rp\.?\s*)?([\d][\d.,]*)/i,
  ];
  for(const re of PATTERNS){
    for(const l of lines){
      const m=l.match(re);
      if(m){ const v=parseNumber(m[1]); if(v!=null){ grand=v; break; } }
    }
    if(grand!=null) break;
  }
  return grand;
}
function extractDate(text){
  // Prioritas 1: tanggal eksplisit berlabel (Tanggal: 25/09/2026, TANGGAL 25-09-2026, Date: ...)
  let m=text.match(/(?:tanggal|tgl|date)\s*[:\-]?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i);
  if(!m) m=text.match(/(?:tanggal|tgl|date)\s*[:\-]?\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr[il]|Mei|Maj|Jun|Jul|Agu|Sep|Okt|Nov|Des)[a-z]*\.?\s+\d{2,4})/i);
  if(m&&m[3]===undefined){ const dm=m[1].match(/(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{2,4})/); if(dm){ const mm={jan:1,feb:2,mar:3,apr:4,mei:5,maj:5,jun:6,jul:7,agu:8,sep:9,okt:10,nov:11,des:12}[dm[2].slice(0,3).toLowerCase()]; if(mm){ const y=dm[3].length===2?('20'+dm[3]):dm[3]; return `${y}-${String(mm).padStart(2,'0')}-${String(dm[1]).padStart(2,'0')}`; } } }
  if(m){ let [_,d,mo,y]=m; y=y.length===2?('20'+y):y; return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  // Prioritas 2: tanggal tanpa label — hindari pola yang bukan tanggal (mis. nomor telepon / jalan "No 5")
  for(const cand of text.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g)){
    let [_,d,mo,y]=cand; y=y.length===2?('20'+y):+y;
    if(+mo>=1&&+mo<=12&&+d>=1&&+d<=31) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  m=text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr[il]|Mei|Maj|Jun|Jul|Agu|Sep|Okt|Nov|Des)[a-z]*\s+(\d{2,4})/i);
  if(m){ const mm={jan:1,feb:2,mar:3,apr:4,mei:5,maj:5,jun:6,jul:7,agu:8,sep:9,okt:10,nov:11,des:12}[m[2].slice(0,3).toLowerCase()]; const y=m[3].length===2?('20'+m[3]):m[3]; return `${y}-${String(mm).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`; }
  return new Date().toISOString().slice(0,10);
}
function extractStore(lines){
  for(let i=0;i<Math.min(5,lines.length);i++){ const l=lines[i].trim(); if(l.length>=3 && !/^[\d:=\/-]+$/.test(l)) return l.slice(0,80); }
  return 'Toko Tidak Diketahui';
}
const PRICE_LINE=/(?:^|\s)(?:Rp\.?\s*)?([\d][\d.,]*)$/i;
function parseItems(lines){
  const items=[];
  for(const l of lines){
    const low=l.toLowerCase();
    if(/total|grand|bayar|kembali|tunai|kasir|tanggal|diskon|ppn|service|tax/.test(low)) continue;
    // pola: "AYAM KAMPUNG 2 15.000 30.000" atau "Sawi Hijau x2 8.000"
    const nums=[...l.matchAll(/(?:Rp\.?\s*)?([\d][\d.,]{1,11})/gi)].map(m=>parseNumber(m[1])).filter(v=>v!=null&&v>0);
    const name=l.replace(/(?:Rp\.?\s*)?[\d][\d.,]*/gi,'').replace(/x?\s*\d+\s*(kg|pcs|pack|gram|gr|ml|l)\b/gi,'').trim();
    if(nums.length>=2 && name.length>=3){
      const qtyMatch=l.match(/[xX*]\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(kg|pcs|pack)/);
      let qty=1;
      if(qtyMatch) qty=parseNumber(qtyMatch[1]||qtyMatch[2])||1;
      else if(nums.length>=3 && nums[nums.length-3]<100 && Number.isInteger(nums[nums.length-3])) { qty=nums[nums.length-3]; nums.splice(nums.length-3,1); }
      const unit=nums.length>=2?nums[nums.length-2]:null, lineAmt=nums[nums.length-1];
      // Bila tidak ada pengali eksplisit namun jumlah baris adalah kelipatan harga satuan
      // (mis. "AYAM KAMPUNG 15.000 30.000"), turunkan qty = line_total / unit_price.
      if(qty===1 && unit && unit>0 && lineAmt>unit && Number.isInteger(lineAmt/unit)) qty=lineAmt/unit;
      items.push({name:name.toUpperCase(),qty,unit_price:unit,line_total:lineAmt});
    }
  }
  return items;
}
function internalParse(rawText){
  const lines=rawText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const store=extractStore(lines);
  const date=extractDate(rawText);
  const total=extractTotal(lines);
  const items=parseItems(lines);
  let conf=30;
  if(total!=null) conf+=30; if(items.length) conf+=Math.min(30,items.length*10); if(date!==new Date().toISOString().slice(0,10)) conf+=10;
  const sumItems=items.reduce((s,i)=>s+(+i.line_total||0),0);
  if(total!=null && sumItems>0) conf += Math.abs(sumItems-total)/total < 0.1 ? 10 : 0;
  return {store,date,total,items,confidence:Math.min(conf,99)};
}
async function googleVision(imagePath){
  const key=config.state.ocrApiKey;
  const fs=require('fs');
  const b64=fs.readFileSync(imagePath).toString('base64');
  const res=await fetch('https://vision.googleapis.com/v1/images:annotate?key='+encodeURIComponent(key),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({requests:[{image:{content:b64},features:[{type:'TEXT_DETECTION'}]}]})});
  if(!res.ok) throw new Error('Vision API HTTP '+res.status);
  const j=await res.json();
  const txt=j?.responses?.[0]?.fullTextAnnotation?.text || j?.responses?.[0]?.textAnnotations?.[0]?.description || '';
  const parsed=internalParse(txt);
  return {text:txt,parsed,engine:'google_vision'};
}
async function processReceipt(imagePath, rawTextInput){
  if(config.state.ocrApiKey && imagePath){
    try{ const r=await googleVision(imagePath); if(r.text) return r; }
    catch(e){ console.warn('[ocr] Vision gagal:',e.message); }
  }
  let text=rawTextInput;
  if(!text && imagePath){
    // engine internal membaca sidecar .txt (untuk pengujian) — pada produksi gunakan Vision
    const fs=require('fs'); const side=imagePath+'.txt';
    if(fs.existsSync(side)) text=fs.readFileSync(side,'utf8');
  }
  if(!text) return {text:'',parsed:{store:null,date:new Date().toISOString().slice(0,10),total:null,items:[],confidence:0},engine:'internal'};
  return {text,parsed:internalParse(text),engine:'internal'};
}
module.exports={processReceipt,internalParse,parseNumber,googleVision};
