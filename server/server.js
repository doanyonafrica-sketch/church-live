const express=require('express'),http=require('http'),os=require('os'),path=require('path');
const {WebSocketServer}=require('ws');
const RELAY=new Set(['offer','answer','candidate']);
const NUM=['cam','fps','mbps','rtt','loss','sec','q','rssi','link','battery','jitter','buf','dropped','lost'],
  STR=['res','codec','limit','level','diag'],BOOL=['muted','charging'];
/* Ne garde que les champs connus, avec des types simples (les statistiques viennent du réseau) */
const clean=m=>{const o={};
  for(const k of NUM)if(typeof m[k]==='number'&&isFinite(m[k]))o[k]=m[k];
  for(const k of STR)if(typeof m[k]==='string')o[k]=m[k].replace(/[<>&"'`]/g,'').slice(0,200);
  for(const k of BOOL)if(typeof m[k]==='boolean')o[k]=m[k];
  o.t=Date.now();return o};
let lastCpu=null;
const cpuPct=()=>{const c=os.cpus().reduce((a,x)=>{for(const k in x.times)a.t+=x.times[k];a.i+=x.times.idle;return a},{t:0,i:0});
  let p=0;if(lastCpu){const dt=c.t-lastCpu.t,di=c.i-lastCpu.i;p=dt>0?Math.round(100*(1-di/dt)):0}lastCpu=c;return p};
function createServer(opts={}){
  /* grace : délai avant d'annoncer un départ. Une coupure WebSocket brève (Wi-Fi) ne doit pas casser le flux vidéo. */
  const GRACE=opts.grace??4000;
  const app=express();
  /* Le téléphone (origine http://localhost dans l'APK) doit pouvoir lire la version de l'APK proposée par le PC */
  app.get('/apk-version.json',(q,r,n)=>{r.set({'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});n()});
  /* Caméras IP (dômes PTZ) : commande ONVIF + image dans la fenêtre du PC (réservé à 127.0.0.1) */
  const cams=opts.cameras===false?null:require('./camera').mount(app,express,{dataDir:opts.dataDir});
  app.use(express.static(path.join(__dirname,'public')));
  const srv=http.createServer(app),wss=new WebSocketServer({server:srv,path:'/ws',maxPayload:1<<17});
  const rooms=new Map();
  const live=w=>!!w&&w.readyState===1;
  app.get('/info',(q,r)=>{const port=srv.address().port,ips=[];
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==='IPv4'&&!i.internal)ips.push(i.address+':'+port);
    const all=[...rooms.values()];
    r.json({app:'tpr-live',name:os.hostname().replace(/[^\w .-]/g,'').slice(0,40)||'PC',obs:'http://localhost:'+port+'/obs.html',addresses:ips,viewers:all.filter(x=>live(x.viewer)).length,publishers:all.filter(x=>live(x.publisher)).length,
      cpu:cpuPct(),
      rooms:[...rooms.entries()].map(([k,x])=>({room:k,publisher:live(x.publisher),viewer:live(x.viewer),onair:live(x.viewer)&&!!x.onair,
        stats:x.stats?{...x.stats,age:Date.now()-x.stats.t}:null,vstats:x.vstats?{...x.vstats,age:Date.now()-x.vstats.t}:null}))});});
  const send=(w,m)=>live(w)&&w.send(JSON.stringify(m));
  /* Détecte les connexions mortes (Wi-Fi coupé sans fermeture propre) et garde la liaison éveillée */
  const hb=setInterval(()=>{for(const w of wss.clients){if(w.dead){w.terminate();continue}w.dead=true;try{w.ping()}catch{}}},10000);
  hb.unref();srv.on('close',()=>{clearInterval(hb);wss.close();if(cams)cams.close()});
  /* Arrêt immédiat : tue ffmpeg (sinon il reste actif et bloque la mise à jour) et coupe les connexions */
  srv.shutdown=()=>{try{if(cams)cams.close()}catch{}for(const w of wss.clients){try{w.terminate()}catch{}}try{srv.close()}catch{}if(srv.closeAllConnections)try{srv.closeAllConnections()}catch{}};
  wss.on('connection',ws=>{
    let room=null,role=null;ws.dead=false;
    ws.on('pong',()=>{ws.dead=false});
    ws.on('error',()=>{});
    ws.on('message',d=>{
      let m;try{m=JSON.parse(d)}catch{return}
      if(!m||typeof m!=='object')return;
      if(m.type==='join'){
        room=String(m.room||'main').slice(0,64);role=m.role==='publisher'?'publisher':'viewer';
        const r=rooms.get(room)||{t:{}};rooms.set(room,r);
        if(r.t[role]){clearTimeout(r.t[role]);delete r.t[role]}   /* retour rapide : on annule l'annonce de départ */
        const old=r[role];r[role]=ws;if(old&&old!==ws)old.close(4000,'replaced');  /* 4000 : remplacé par un autre appareil, ne pas se reconnecter */
        if(role==='viewer'){r.active=m.active===true;r.onair=m.onair===true;send(r.publisher,{type:'viewer-joined',keep:r.active});send(r.publisher,{type:'onair',value:r.onair})}
        else{if(r.viewer)send(ws,{type:'viewer-joined',keep:!!r.active});send(ws,{type:'onair',value:live(r.viewer)&&!!r.onair})}  /* le téléphone connaît tout de suite son statut */
        return;
      }
      const r=rooms.get(room);if(!r)return;
      if(m.type==='active'){if(role==='viewer')r.active=!!m.value;return}
      /* « à l'antenne » : OBS dit si cette caméra est dans le programme ET reçue. Seul OBS (viewer) peut l'affirmer. */
      if(m.type==='onair'){if(role==='viewer'){r.onair=m.value===true;send(r.publisher,{type:'onair',value:r.onair})}return}
      if(m.type==='stats'){if(role==='publisher')r.stats=clean(m);return}
      if(m.type==='vstats'){if(role==='viewer')r.vstats=clean(m);return}
      if(!RELAY.has(m.type))return;
      send(role==='publisher'?r.viewer:r.publisher,m);
    });
    ws.on('close',()=>{
      const r=rooms.get(room);if(!r||r[role]!==ws)return;
      r[role]=null;if(role==='viewer'){r.active=false;r.onair=false;r.vstats=null}else r.stats=null;
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
module.exports={createServer};
if(require.main===module){
  const port=process.env.PORT||3000;
  createServer().listen(port,'0.0.0.0',()=>{
    console.log('\n=== Church Live : serveur prêt ===');
    console.log('Source OBS (Source Navigateur) : http://localhost:'+port+'/obs.html');
    console.log('Test avec la caméra du PC      : http://localhost:'+port+'/camera.html');
    console.log("Adresse à saisir dans l'app Android :");
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)
      if(i.family==='IPv4'&&!i.internal)console.log('   ws://'+i.address+':'+port+'/ws');
  });
}
