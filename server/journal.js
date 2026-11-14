/* Journal du direct : enregistre automatiquement, sur le PC, tout ce qui sert à comprendre ce qui s'est passé pendant un culte
   (connexions, coupures, reprises, mesures réseau, événements envoyés par le téléphone et par la page OBS).
   Un fichier par jour (journal-AAAA-MM-JJ.jsonl, une ligne = un événement), conservé 30 jours.
   Aucun code d'appairage, aucune image, aucun son : seulement des chiffres et des états. */
const fs=require('fs'),path=require('path'),os=require('os');
const KEEP_DAYS=30,MAX_BYTES=40*1024*1024;
const pad=n=>String(n).padStart(2,'0');
const dayOf=t=>{const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
/* Date et heure locales du PC, lisibles : « 2026-11-14 16:25:03 » */
const stamp=t=>{const d=new Date(t);return dayOf(t)+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())};
function createJournal(dir){
  const base=path.join(dir||process.env.TPR_DATA||path.join(os.homedir(),'.tpr-live'),'journal');
  try{fs.mkdirSync(base,{recursive:true})}catch{}
  /* ménage : fichiers de plus de 30 jours */
  try{for(const f of fs.readdirSync(base)){const m=/^journal-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if(m&&Date.now()-new Date(m[1]+'T12:00:00').getTime()>KEEP_DAYS*864e5)try{fs.unlinkSync(path.join(base,f))}catch{}}}catch{}
  const sizes=new Map();
  function log(ev,d,t){
    try{t=t||Date.now();const f=path.join(base,'journal-'+dayOf(t)+'.jsonl');
      const n=sizes.get(f)||0;if(n>MAX_BYTES)return;
      const line=JSON.stringify({h:stamp(t),ev,...(d||{}),t})+'\n';sizes.set(f,n+line.length);
      fs.appendFile(f,line,()=>{})}catch{}
  }
  const files=(days,date)=>{try{
    if(/^\d{4}-\d{2}-\d{2}$/.test(date||'')){const f=path.join(base,'journal-'+date+'.jsonl');return fs.existsSync(f)?[f]:[]}
    const lim=Date.now()-Math.max(1,days||1)*864e5;
    return fs.readdirSync(base).filter(f=>/^journal-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)&&new Date(f.slice(8,18)+'T23:59:59').getTime()>=lim).sort().map(f=>path.join(base,f))}catch{return[]}};
  const read=(days,date)=>{const out=[];for(const f of files(days,date))try{for(const l of fs.readFileSync(f,'utf8').split('\n')){if(!l)continue;try{out.push(JSON.parse(l))}catch{}}}catch{}return out};
  return{log,files,read,dir:base};
}
/* Nettoie un événement envoyé par le téléphone ou la page OBS : noms et valeurs simples, tailles limitées */
function cleanClientLog(m,now){
  const out=[];if(!m||!Array.isArray(m.items))return out;
  for(const it of m.items.slice(0,50)){
    if(!it||typeof it!=='object'||typeof it.ev!=='string'||!/^[a-z0-9_-]{1,32}$/.test(it.ev))continue;
    const o={ev:it.ev},ago=typeof it.ago==='number'&&isFinite(it.ago)?Math.min(Math.max(it.ago,0),864e5):0;
    if(it.d&&typeof it.d==='object'){let n=0;
      for(const k of Object.keys(it.d)){if(n>=8)break;if(!/^[a-z0-9_]{1,16}$/.test(k))continue;const v=it.d[k];
        if(typeof v==='number'&&isFinite(v)){o[k]=v;n++}else if(typeof v==='boolean'){o[k]=v;n++}
        else if(typeof v==='string'){o[k]=v.replace(/[<>&"'`\r\n]/g,'').slice(0,120);n++}}}
    o.t=now-ago;out.push(o)}
  return out;
}
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,r1=x=>x==null?null:Math.round(x*10)/10;
const fmtDur=s=>{s=Math.round(s);return s<60?s+' s':s<3600?Math.floor(s/60)+' min '+pad(s%60)+' s':Math.floor(s/3600)+' h '+pad(Math.floor(s/60)%60)+' min'};
const dm=t=>{const d=new Date(t);return pad(d.getDate())+'/'+pad(d.getMonth()+1)+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())};
const longDate=t=>new Date(t).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const clock=t=>{const d=new Date(t);return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())};
const GAP=15*60e3;   /* plus de 15 minutes sans aucun événement = nouvelle session (un autre test, un autre culte) */
function sessions(ev){const out=[];let cur=null;
  for(const e of ev){if(!cur||e.t-cur.end>GAP){cur={start:e.t,end:e.t,ev:[]};out.push(cur)}cur.ev.push(e);cur.end=e.t}
  return out}
function summarizeSession(ev,L){
  const rooms={};
  const R=k=>rooms[k]||(rooms[k]={pubJoin:0,pubClose:0,viewJoin:0,viewClose:0,dead:0,left:0,needOffer:0,codes:{},outages:[],snaps:[],client:{},busy:0,denied:0,since:null,sets:[],remote:0});
  const starts=[];
  for(const e of ev){
    if(e.ev==='server-start'){starts.push(e.t);continue}
    if(!e.room)continue;const r=R(e.room);
    if(e.ev==='join'){if(e.role==='publisher'){r.pubJoin++;if(r.since!=null){r.outages.push({from:r.since,to:e.t,secs:(e.t-r.since)/1000});r.since=null}}else r.viewJoin++}
    else if(e.ev==='close'){const k=e.role+':'+e.code;r.codes[k]=(r.codes[k]||0)+1;
      if(e.role==='publisher'){r.pubClose++;if(e.code!==4000&&r.since==null)r.since=e.t}else r.viewClose++}
    else if(e.ev==='dead')r.dead++;
    else if(e.ev==='left')r.left++;
    else if(e.ev==='need-offer')r.needOffer++;
    else if(e.ev==='busy')r.busy++;
    else if(e.ev==='denied')r.denied++;
    else if(e.ev==='remote-set')r.remote++;
    else if(e.ev==='settings')r.sets.push(e);
    else if(e.ev==='snap')r.snaps.push(e);
    else if(e.ev.startsWith('c:')){const k=(e.role||'?')+' '+e.ev.slice(2);r.client[k]=(r.client[k]||0)+1}
  }
  if(starts.length)L.push('Serveur démarré à : '+starts.map(dm).join(', ')+'.');
  for(const [name,r] of Object.entries(rooms)){
    L.push('','--- Caméra « '+name+' » ---');
    const live=r.snaps.filter(s=>s.pub&&s.view);
    L.push('Téléphone : '+r.pubJoin+' connexion(s), '+r.pubClose+' fermeture(s). OBS : '+r.viewJoin+' connexion(s), '+r.viewClose+' fermeture(s).');
    L.push('Liaisons détectées mortes par le serveur : '+r.dead+'. Départs annoncés (coupure > 4 s) : '+r.left+'. Renégociations demandées par OBS : '+r.needOffer+'.');
    if(r.busy||r.denied)L.push('Refus : '+r.busy+' caméra occupée, '+r.denied+' mauvais code.');
    const codes=Object.entries(r.codes).map(([k,v])=>k+' ×'+v).join(', ');if(codes)L.push('Codes de fermeture : '+codes+' (1006 = coupure brutale du réseau, 4000 = remplacé, 4001 = occupé, 4003 = code refusé).');
    if(r.outages.length){const worst=Math.max(...r.outages.map(o=>o.secs));
      L.push('Coupures du téléphone : '+r.outages.length+' (plus longue : '+fmtDur(worst)+', moyenne : '+fmtDur(avg(r.outages.map(o=>o.secs)))+').');
      for(const o of r.outages.slice(0,15))L.push('   • '+dm(o.from)+' → '+dm(o.to)+'  ('+fmtDur(o.secs)+')');
      if(r.outages.length>15)L.push('   … et '+(r.outages.length-15)+' autres.')}
    else L.push('Aucune coupure complète du téléphone.');
    if(r.sets.length){const seen=[];for(const e of r.sets){const d='qualité '+e.q+'p, priorité '+e.prio+', fluidité '+e.fluid+', codec '+e.codec+(e.muted?', micro coupé':'');
        if(!seen.length||seen[seen.length-1].d!==d)seen.push({t:e.t,d})}
      L.push('Réglages du téléphone : '+seen.slice(0,6).map(x=>clock(x.t)+' '+x.d).join(' ; ')+(seen.length>6?' ; …':'')+(r.remote?' (réglages envoyés depuis le PC : '+r.remote+')':''))}
    if(r.snaps.length){
      const col=k=>r.snaps.map(s=>s[k]).filter(x=>typeof x==='number'),mn=a=>a.length?Math.min(...a):null,mx=a=>a.length?Math.max(...a):null;
      L.push('Pendant le direct ('+fmtDur(live.length*10)+' avec téléphone et OBS reliés) :');
      L.push('   images/s : moyenne '+r1(avg(col('fps')))+', minimum '+mn(col('fps'))+'   |   débit : moyenne '+r1(avg(col('mbps')))+' Mb/s, minimum '+mn(col('mbps')));
      L.push('   latence : moyenne '+r1(avg(col('rtt')))+' ms, maximum '+mx(col('rtt'))+' ms   |   pertes : moyenne '+r1(avg(col('loss')))+' %, maximum '+mx(col('loss'))+' %');
      L.push('   gigue côté OBS : max '+mx(col('vjitter'))+' ms   |   images perdues par OBS : '+col('vdropped').reduce((a,b)=>a+b,0)+'   |   paquets perdus : '+col('vlost').reduce((a,b)=>a+b,0));
      L.push('   Wi-Fi (rssi) : pire '+mn(col('rssi'))+' dBm   |   batterie : minimum '+mn(col('battery'))+' %   |   chauffe max : '+mx(col('thermal')));
      const lim={};for(const s of r.snaps)if(s.limit&&s.limit!=='none')lim[s.limit]=(lim[s.limit]||0)+1;
      const ls=Object.entries(lim).map(([k,v])=>k+' '+v*10+' s').join(', ');if(ls)L.push('   Qualité limitée par : '+ls);
      const bad=r.snaps.filter(s=>s.level==='bad').length*10;if(bad)L.push('   Temps en alerte « mauvais » : '+fmtDur(bad));
    }
    const cl=Object.entries(r.client).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' ×'+v);
    if(cl.length)L.push('Événements signalés par les appareils : '+cl.join(', '));
  }
  return Object.keys(rooms);
}
/* Résumé lisible, découpé par session (une session = une période d'activité, séparée de la suivante par plus de 15 minutes de silence) */
function summarize(ev){
  if(!ev.length)return{text:'Aucun événement enregistré pour la période demandée.',rooms:[],sessions:0};
  const S=sessions(ev),L=[];
  L.push('JOURNAL TPR LIVE — '+ev.length+' événements, '+S.length+' session(s) du '+dm(ev[0].t)+' au '+dm(ev[ev.length-1].t));
  L.push('Sessions :');
  S.forEach((x,i)=>L.push('   '+(i+1)+') '+longDate(x.start)+', '+clock(x.start)+' → '+(longDate(x.end)!==longDate(x.start)?dm(x.end):clock(x.end))+' ('+fmtDur((x.end-x.start)/1000)+')'));
  const all=new Set();
  S.forEach((x,i)=>{
    L.push('','==================== SESSION '+(i+1)+' — '+longDate(x.start)+', '+clock(x.start)+' → '+(longDate(x.end)!==longDate(x.start)?dm(x.end):clock(x.end))+' ====================');
    for(const k of summarizeSession(x.ev,L))all.add(k)});
  return{text:L.join('\n'),rooms:[...all],sessions:S.length};
}
module.exports={createJournal,cleanClientLog,summarize};
