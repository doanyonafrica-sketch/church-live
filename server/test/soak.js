/* Test de longue durée (manuel) : une vraie liaison vidéo téléphone → PC → OBS pendant SOAK_SECONDS (30 par défaut),
   avec une coupure Wi-Fi simulée toutes les 10 s. Vérifie que l'image ne s'arrête jamais et que la mémoire ne grossit pas.
   Pour un vrai culte : SOAK_SECONDS=10800 npm run soak   (3 heures) */
const assert=require('assert'),WebSocket=require('ws');
const {createServer}=require('../server');
const {RTCPeerConnection,nonstandard:{RTCVideoSource,RTCVideoSink}}=require('@roamhq/wrtc');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const SECONDS=+process.env.SOAK_SECONDS||30;
const open=(port,role,room='soak')=>new Promise(r=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws');w.on('message',d=>w.h&&w.h(JSON.parse(d)));w.on('open',()=>{w.send(JSON.stringify({type:'join',role,room,id:role+'1'}));r(w)})});
(async()=>{
  const srv=createServer({grace:4000});await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
  const src=new RTCVideoSource(),track=src.createTrack(),W=320,H=240;let n=0;
  const timer=setInterval(()=>{const d=new Uint8ClampedArray(W*H*1.5);d.fill(64+(n++%128));src.onFrame({width:W,height:H,data:d})},66);
  let ppc,pub;
  const wirePub=w=>{w.h=async m=>{
    if(m.type==='viewer-joined'){if(m.keep&&ppc&&ppc.connectionState==='connected')return;
      ppc=new RTCPeerConnection({iceServers:[]});ppc.onicecandidate=e=>e.candidate&&w.send(JSON.stringify({type:'candidate',candidate:e.candidate}));
      ppc.addTrack(track);const o=await ppc.createOffer();await ppc.setLocalDescription(o);w.send(JSON.stringify({type:'offer',sdp:o.sdp}))}
    else if(m.type==='answer')await ppc.setRemoteDescription({type:'answer',sdp:m.sdp});
    else if(m.type==='candidate'&&ppc)await ppc.addIceCandidate(m.candidate).catch(()=>{})}};
  pub=await open(port,'publisher');wirePub(pub);
  const vw=await open(port,'viewer');let vpc,frames=0;
  vw.h=async m=>{
    if(m.type==='offer'){vpc=new RTCPeerConnection({iceServers:[]});vpc.onicecandidate=e=>e.candidate&&vw.send(JSON.stringify({type:'candidate',candidate:e.candidate}));
      vpc.ontrack=e=>{new RTCVideoSink(e.track).onframe=()=>frames++};
      await vpc.setRemoteDescription({type:'offer',sdp:m.sdp});const a=await vpc.createAnswer();await vpc.setLocalDescription(a);vw.send(JSON.stringify({type:'answer',sdp:a.sdp}));
      vw.send(JSON.stringify({type:'active',value:true}))}
    else if(m.type==='candidate'&&vpc)await vpc.addIceCandidate(m.candidate).catch(()=>{})};
  for(let i=0;i<50&&frames<30;i++)await wait(200);
  assert(frames>=30,'la liaison ne démarre pas');
  global.gc&&global.gc();const rss0=process.memoryUsage().rss,heap0=process.memoryUsage().heapUsed;let last=frames,blips=0,stalls=0,t0=Date.now();
  while((Date.now()-t0)/1000<SECONDS){
    await wait(5000);
    if(frames===last){stalls++;console.log('  ! aucune image reçue pendant 5 s');}
    last=frames;
    if(++blips%2===0){pub.close();await wait(500);pub=await open(port,'publisher');wirePub(pub)}   /* coupure Wi-Fi brève */
  }
  clearInterval(timer);global.gc&&global.gc();
  const growth=(process.memoryUsage().rss-rss0)/1048576,heap=(process.memoryUsage().heapUsed-heap0)/1048576;
  console.log('Durée '+SECONDS+' s, images reçues : '+frames+', coupures simulées : '+Math.floor(blips/2)+', arrêts d\'image : '+stalls+', mémoire +'+growth.toFixed(1)+' Mo (JavaScript : '+(heap>=0?'+':'')+heap.toFixed(1)+' Mo)');
  assert.strictEqual(stalls,0,'l\'image s\'est arrêtée');
  assert(heap<30,'le JavaScript grossit trop : +'+heap.toFixed(1)+' Mo');
  assert(growth<80,'la mémoire grossit trop : +'+growth.toFixed(1)+' Mo');
  console.log('OK longue durée');process.exit(0);
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
