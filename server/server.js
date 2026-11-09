const express=require('express'),http=require('http'),os=require('os'),path=require('path'),fs=require('fs'),crypto=require('crypto');
const {WebSocketServer}=require('ws');
const {isLocalAddr,hostOk,originOk,localRequestOk}=require('./security');
const RELAY=new Set(['offer','answer','candidate']);
const NUM=['cam','fps','mbps','rtt','loss','sec','q','rssi','link','battery','thermal','jitter','buf','dropped','lost'],
  STR=['res','codec','limit','level','diag'],BOOL=['muted','charging'];
/* Ne garde que les champs connus, avec des types simples (les statistiques viennent du réseau) */
const clean=m=>{const o={};
  for(const k of NUM)if(typeof m[k]==='number'&&isFinite(m[k]))o[k]=m[k];
  for(const k of STR)if(typeof m[k]==='string')o[k]=m[k].replace(/[<>&"'`]/g,'').slice(0,200);
  for(const k of BOOL)if(typeof m[k]==='boolean')o[k]=m[k];
  o.t=Date.now();return o};
/* Réglages du téléphone modifiables depuis le PC. Valeurs strictement vérifiées : le PC les envoie, le téléphone les revérifie. */
const SETK={q:[480,720,1080],prio:['sharp','fluid'],fluid:['off','on','max'],codec:['auto','h264','vp8']};
const num=(v,a,b)=>typeof v==='number'&&isFinite(v)&&v>=a&&v<=b;
function cleanSet(m){const o={};if(!m||typeof m!=='object')return o;
  if(SETK.q.includes(m.q))o.q=m.q;
  for(const k of['prio','fluid','codec'])if(SETK[k].includes(m[k]))o[k]=m[k];
  if(Number.isInteger(m.mvol)&&m.mvol>=0&&m.mvol<=100)o.mvol=m.mvol;
  for(const k of['muted','torch'])if(typeof m[k]==='boolean')o[k]=m[k];
  if(num(m.zoom,0,100))o.zoom=m.zoom;
  return o}
/* Rapport du téléphone : ses réglages actuels et ce que sa caméra sait faire (flash, plage de zoom) */
function cleanRep(m){const o=cleanSet(m);
  for(const k of['zmin','zmax','zstep'])if(num(m[k],0,1000))o[k]=m[k];
  if(typeof m.ctorch==='boolean')o.ctorch=m.ctorch;
  o.t=Date.now();return o}
/* Code d'appairage (6 chiffres) : sans lui, n'importe quel appareil du Wi-Fi pourrait se faire passer pour une caméra ou pour OBS.
   Il est créé une fois, enregistré dans le dossier de données du PC et affiché dans la fenêtre TPR Live.
   Désactivable avec la variable d'environnement TPR_NO_PIN=1. Le PC lui-même (127.0.0.1, donc OBS) n'en a pas besoin. */
function loadPin(dir){
  if(process.env.TPR_NO_PIN==='1')return null;
  const f=path.join(dir||process.env.TPR_DATA||path.join(os.homedir(),'.tpr-live'),'pin.txt');
  try{const p=fs.readFileSync(f,'utf8').trim();if(/^\d{6}$/.test(p))return p}catch{}
  const p=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  try{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,p)}catch{}
  return p;
}
let lastCpu=null;
const cpuPct=()=>{const c=os.cpus().reduce((a,x)=>{for(const k in x.times)a.t+=x.times[k];a.i+=x.times.idle;return a},{t:0,i:0});
  let p=0;if(lastCpu){const dt=c.t-lastCpu.t,di=c.i-lastCpu.i;p=dt>0?Math.round(100*(1-di/dt)):0}lastCpu=c;return p};
function createServer(opts={}){
  /* grace : délai avant d'annoncer un départ. Une coupure WebSocket brève (Wi-Fi) ne doit pas casser le flux vidéo. */
  const GRACE=opts.grace??4000;
  const PIN=opts.pin||null,fails=new Map();   /* échecs de code par adresse : au-delà de 10, blocage d'une minute */
  const app=express();
  /* Le téléphone (origine http://localhost dans l'APK) doit pouvoir lire la version de l'APK proposée par le PC */
  app.get('/apk-version.json',(q,r,n)=>{r.set({'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});n()});
  /* Caméras IP (dômes PTZ) : commande ONVIF + image dans la fenêtre du PC (réservé à 127.0.0.1) */
  const cams=opts.cameras===false?null:require('./camera').mount(app,express,{dataDir:opts.dataDir,cipher:opts.cipher});
  app.use(express.static(path.join(__dirname,'public')));
  const srv=http.createServer(app),wss=new WebSocketServer({server:srv,path:'/ws',maxPayload:1<<17,
    /* Refuse les pages d'autres sites (détournement depuis un navigateur du PC) et le DNS rebinding */
    verifyClient:({req})=>{const local=isLocalAddr(req.socket.remoteAddress);
      return originOk(req.headers.origin,req.headers.host,local)&&(!local||hostOk(req.headers.host))}});
  const rooms=new Map();
  const live=w=>!!w&&w.readyState===1;
  app.get('/info',(q,r)=>{
    /* Un appareil du réseau ne voit que ce qu'il faut pour retrouver le PC (la recherche automatique du téléphone) */
    if(!isLocalAddr(q.socket.remoteAddress)||!hostOk(q.headers.host)||!originOk(q.headers.origin,q.headers.host,true))return r.json({app:'tpr-live',name:os.hostname().replace(/[^\w .-]/g,'').slice(0,40)||'PC',pin:!!PIN});
    const port=srv.address().port,ips=[];
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==='IPv4'&&!i.internal)ips.push(i.address+':'+port);
    const all=[...rooms.values()];
    r.json({app:'tpr-live',pin:PIN,name:os.hostname().replace(/[^\w .-]/g,'').slice(0,40)||'PC',obs:'http://localhost:'+port+'/obs.html',addresses:ips,viewers:all.filter(x=>live(x.viewer)).length,publishers:all.filter(x=>live(x.publisher)).length,
      cpu:cpuPct(),
      rooms:[...rooms.entries()].map(([k,x])=>({room:k,publisher:live(x.publisher),viewer:live(x.viewer),onair:live(x.viewer)&&!!x.onair,
        settings:x.settings?{...x.settings,age:Date.now()-x.settings.t}:null,stats:x.stats?{...x.stats,age:Date.now()-x.stats.t}:null,vstats:x.vstats?{...x.vstats,age:Date.now()-x.vstats.t}:null}))});});
  const send=(w,m)=>live(w)&&w.send(JSON.stringify(m));
  /* Réglages envoyés par la fenêtre du PC à un téléphone. Réservé au PC lui-même (même protection que les caméras IP). */
  app.post('/api/phone/:room/set',express.json({limit:'2kb'}),(q,r)=>{
    if(!localRequestOk(q))return r.status(403).json({ok:false,error:'Réservé au PC qui exécute TPR Live.'});
    const x=rooms.get(String(q.params.room).slice(0,64)),set=cleanSet(q.body&&q.body.set);
    if(!Object.keys(set).length)return r.status(400).json({ok:false,error:'Réglage invalide.'});
    if(!x||!live(x.publisher))return r.status(404).json({ok:false,error:'Téléphone non connecté.'});
    if(!x.settings)return r.status(409).json({ok:false,error:'Ce téléphone doit être mis à jour pour être réglé depuis le PC.'});
    send(x.publisher,{type:'set',set});r.json({ok:true,sent:set})});
  app.use('/api/phone',(e,q,r,n)=>r.status(400).json({ok:false,error:'Requête illisible.'}));

  /* Détecte les connexions mortes (Wi-Fi coupé sans fermeture propre) et garde la liaison éveillée */
  const hb=setInterval(()=>{for(const w of wss.clients){if(w.dead){w.terminate();continue}w.dead=true;try{w.ping()}catch{}}},10000);
  hb.unref();const hb2=setInterval(()=>{if(fails.size>500)fails.clear()},60000);hb2.unref();srv.on('close',()=>{clearInterval(hb);clearInterval(hb2);wss.close();if(cams)cams.close()});
  /* Arrêt immédiat : tue ffmpeg (sinon il reste actif et bloque la mise à jour) et coupe les connexions */
  /* Nombre de téléphones en direct : le PC s'en sert pour demander confirmation avant de quitter et pour ne pas se mettre à jour pendant un direct */
  srv.liveCount=()=>[...rooms.values()].filter(x=>live(x.publisher)).length;
  srv.shutdown=()=>{try{if(cams)cams.close()}catch{}for(const w of wss.clients){try{w.terminate()}catch{}}try{srv.close()}catch{}if(srv.closeAllConnections)try{srv.closeAllConnections()}catch{}};
  wss.on('connection',(ws,req)=>{
    let room=null,role=null;ws.dead=false;ws._ip=req.socket.remoteAddress||'';
    ws.on('pong',()=>{ws.dead=false});
    ws.on('error',()=>{});
    let wStart=Date.now(),wCount=0;
    ws.on('message',d=>{
      /* Anti-inondation : un appareil qui envoie plus de 150 messages par seconde est coupé (le trafic normal en envoie une dizaine) */
      const tn=Date.now();if(tn-wStart>1000){wStart=tn;wCount=0}
      if(++wCount>150){ws.terminate();return}
      let m;try{m=JSON.parse(d)}catch{return}
      if(!m||typeof m!=='object')return;
      if(m.type==='join'){
        const nr=String(m.room||'main').slice(0,64),nrole=m.role==='publisher'?'publisher':'viewer',cid=typeof m.id==='string'?m.id.slice(0,40):'';
        /* Code d'appairage (sauf pour le PC lui-même) */
        const ip=ws._ip||'';
        if(PIN&&!isLocalAddr(ip)){
          const f=fails.get(ip)||{n:0,until:0};
          if(Date.now()<f.until){ws.close(4003,'blocked');return}
          if(String(m.code||'')!==PIN){if(++f.n>=10){f.until=Date.now()+60000;f.n=0}fails.set(ip,f);send(ws,{type:'denied'});ws.close(4003,'code');return}
          fails.delete(ip);
        }
        /* Place déjà prise par un autre appareil : on REFUSE le nouveau venu (4001) au lieu de couper celui qui est en ligne.
           Même appareil qui revient (même identifiant, ex. après une coupure Wi-Fi) : il reprend sa place (4000 pour l'ancienne connexion). */
        if(!rooms.has(nr)&&rooms.size>=16){ws.close(1013,'rooms');return}   /* au plus 16 caméras simultanées */
        const cur=rooms.get(nr);
        if(cur&&live(cur[nrole])&&cur[nrole]!==ws&&!(cid&&cur[nrole].cid===cid)){send(ws,{type:'busy'});ws.close(4001,'busy');return}
        room=nr;role=nrole;ws.cid=cid;
        const r=rooms.get(room)||{t:{}};rooms.set(room,r);
        if(r.t[role]){clearTimeout(r.t[role]);delete r.t[role]}   /* retour rapide : on annule l'annonce de départ */
        const old=r[role];r[role]=ws;if(old&&old!==ws)old.close(4000,'replaced');  /* 4000 : remplacé par le même appareil, ne pas se reconnecter */
        if(role==='viewer'){r.active=m.active===true;r.onair=m.onair===true;send(r.publisher,{type:'viewer-joined',keep:r.active});send(r.publisher,{type:'onair',value:r.onair})}
        else{if(r.viewer)send(ws,{type:'viewer-joined',keep:!!r.active});send(ws,{type:'onair',value:live(r.viewer)&&!!r.onair})}  /* le téléphone connaît tout de suite son statut */
        return;
      }
      const r=rooms.get(room);if(!r)return;
      if(m.type==='active'){if(role==='viewer')r.active=!!m.value;return}
      /* « à l'antenne » : OBS dit si cette caméra est dans le programme ET reçue. Seul OBS (viewer) peut l'affirmer. */
      if(m.type==='onair'){if(role==='viewer'){r.onair=m.value===true;send(r.publisher,{type:'onair',value:r.onair})}return}
      if(m.type==='settings'){if(role==='publisher')r.settings=cleanRep(m);return}
      if(m.type==='stats'){if(role==='publisher')r.stats=clean(m);return}
      if(m.type==='vstats'){if(role==='viewer')r.vstats=clean(m);return}
      if(!RELAY.has(m.type))return;
      send(role==='publisher'?r.viewer:r.publisher,m);
    });
    ws.on('close',()=>{
      const r=rooms.get(room);if(!r||r[role]!==ws)return;
      r[role]=null;if(role==='viewer'){r.active=false;r.onair=false;r.vstats=null}else{r.stats=null;r.settings=null}
      const other=role==='viewer'?'publisher':'viewer';
      r.t[role]=setTimeout(()=>{
        delete r.t[role];
        send(r[other],{type:role==='viewer'?'viewer-left':'publisher-left'});
        if(!r.publisher&&!r.viewer&&!r.t.publisher&&!r.t.viewer)rooms.delete(room);
      },GRACE);
      r.t[role].unref();
    });
  });
  return srv;
}
module.exports={createServer,loadPin};
if(require.main===module){
  process.on('uncaughtException',e=>console.error('Erreur inattendue (le serveur continue) :',e&&e.stack||e));
  process.on('unhandledRejection',e=>console.error('Promesse rejetée (le serveur continue) :',e&&e.stack||e));
  const port=process.env.PORT||3000;
  const pin=loadPin();
  createServer({pin}).listen(port,'0.0.0.0',()=>{
    console.log('\n=== Church Live : serveur prêt ===');
    console.log('Source OBS (Source Navigateur) : http://localhost:'+port+'/obs.html');
    console.log('Test avec la caméra du PC      : http://localhost:'+port+'/camera.html');
    if(pin)console.log("Code d'appairage à saisir sur le téléphone : "+pin);
    console.log("Adresse à saisir dans l'app Android :");
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)
      if(i.family==='IPv4'&&!i.internal)console.log('   ws://'+i.address+':'+port+'/ws');
  });
}
