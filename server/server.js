const express=require('express'),http=require('http'),os=require('os'),path=require('path');
const {WebSocketServer}=require('ws');
const RELAY=new Set(['offer','answer','candidate']);
function createServer(opts={}){
  /* grace : délai avant d'annoncer un départ. Une coupure WebSocket brève (Wi-Fi) ne doit pas casser le flux vidéo. */
  const GRACE=opts.grace??4000;
  const app=express();app.use(express.static(path.join(__dirname,'public')));
  const srv=http.createServer(app),wss=new WebSocketServer({server:srv,path:'/ws',maxPayload:1<<17});
  const rooms=new Map();
  const live=w=>!!w&&w.readyState===1;
  app.get('/info',(q,r)=>{const port=srv.address().port,ips=[];
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==='IPv4'&&!i.internal)ips.push(i.address+':'+port);
    const all=[...rooms.values()];
    r.json({obs:'http://localhost:'+port+'/obs.html',addresses:ips,viewers:all.filter(x=>live(x.viewer)).length,publishers:all.filter(x=>live(x.publisher)).length});});
  const send=(w,m)=>live(w)&&w.send(JSON.stringify(m));
  /* Détecte les connexions mortes (Wi-Fi coupé sans fermeture propre) et garde la liaison éveillée */
  const hb=setInterval(()=>{for(const w of wss.clients){if(w.dead){w.terminate();continue}w.dead=true;try{w.ping()}catch{}}},10000);
  hb.unref();srv.on('close',()=>{clearInterval(hb);wss.close()});
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
        const old=r[role];r[role]=ws;if(old&&old!==ws)old.close();
        if(role==='viewer'){r.active=m.active===true;send(r.publisher,{type:'viewer-joined',keep:r.active})}
        else if(r.viewer)send(ws,{type:'viewer-joined',keep:!!r.active});
        return;
      }
      const r=rooms.get(room);if(!r)return;
      if(m.type==='active'){if(role==='viewer')r.active=!!m.value;return}
      if(!RELAY.has(m.type))return;
      send(role==='publisher'?r.viewer:r.publisher,m);
    });
    ws.on('close',()=>{
      const r=rooms.get(room);if(!r||r[role]!==ws)return;
      r[role]=null;if(role==='viewer')r.active=false;
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
