const express=require('express'),http=require('http'),os=require('os'),path=require('path');
const {WebSocketServer}=require('ws');
function createServer(){
  const app=express();app.use(express.static(path.join(__dirname,'public')));
  const srv=http.createServer(app),wss=new WebSocketServer({server:srv,path:'/ws'});
  const rooms=new Map();
  app.get('/info',(q,r)=>{const port=srv.address().port,ips=[];
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==='IPv4'&&!i.internal)ips.push(i.address+':'+port);
    r.json({obs:'http://localhost:'+port+'/obs.html',addresses:ips,viewers:[...rooms.values()].filter(x=>x.viewer).length,publishers:[...rooms.values()].filter(x=>x.publisher).length});});
  const send=(w,m)=>w&&w.readyState===1&&w.send(JSON.stringify(m));
  wss.on('connection',ws=>{
    let room=null,role=null;
    ws.on('message',d=>{
      let m;try{m=JSON.parse(d)}catch{return}
      if(m.type==='join'){
        room=String(m.room||'main');role=m.role==='publisher'?'publisher':'viewer';
        const r=rooms.get(room)||{};rooms.set(room,r);
        const old=r[role];r[role]=ws;if(old&&old!==ws)old.close();
        if(role==='viewer')send(r.publisher,{type:'viewer-joined'});
        if(role==='publisher'&&r.viewer)send(ws,{type:'viewer-joined'});
        return;
      }
      const r=rooms.get(room);if(r)send(role==='publisher'?r.viewer:r.publisher,m);
    });
    ws.on('close',()=>{
      const r=rooms.get(room);if(!r||r[role]!==ws)return;
      delete r[role];
      send(role==='viewer'?r.publisher:r.viewer,{type:role==='viewer'?'viewer-left':'publisher-left'});
      if(!r.publisher&&!r.viewer)rooms.delete(room);
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
