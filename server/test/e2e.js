const assert=require('assert'),WebSocket=require('ws');
const {createServer}=require('../server');
const {RTCPeerConnection,nonstandard:{RTCVideoSource,RTCVideoSink}}=require('@roamhq/wrtc');
const open=(port,role,room='t')=>new Promise(r=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws');w.q=[];w.on('message',d=>{const m=JSON.parse(d);w.q.push(m);w.h&&w.h(m)});w.on('open',()=>{w.send(JSON.stringify({type:'join',role,room}));r(w)})});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=createServer({grace:300});await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
  let pub=await open(port,'publisher'),view=await open(port,'viewer'),other=await open(port,'viewer','autre');
  await wait(100);
  assert(pub.q.some(m=>m.type==='viewer-joined'),'viewer-joined reçu');
  assert(!other.q.length,'salles isolées');
  pub.send(JSON.stringify({type:'offer',sdp:'x'}));await wait(100);
  assert(view.q.some(m=>m.type==='offer'),'offre relayée');
  view.close();await wait(100);
  assert(!pub.q.some(m=>m.type==='viewer-left'),'départ non annoncé pendant le délai de grâce');
  await wait(500);
  assert(pub.q.some(m=>m.type==='viewer-left'),'viewer-left reçu après le délai de grâce');
  /* coupure brève : le téléphone revient avant la fin du délai, OBS ne voit rien */
  const view2=await open(port,'viewer');view2.send(JSON.stringify({type:'active',value:true}));await wait(100);
  pub.q.length=0;view2.q.length=0;
  pub.close();await wait(100);
  const pub2=await open(port,'publisher');await wait(100);
  assert(!view2.q.some(m=>m.type==='publisher-left'),'OBS non prévenu d\'une coupure brève du téléphone');
  assert(pub2.q.some(m=>m.type==='viewer-joined'&&m.keep===true),'téléphone informé que OBS garde le flux (keep)');
  view2.close();pub2.close();await wait(100);
  /* deux téléphones sur la même caméra : le NOUVEAU est refusé (4001), celui qui est en ligne n'est pas coupé */
  const pA=await open(port,'publisher','camX'),pO=await open(port,'publisher','camY');let codeA=null,codeB=null;pA.on('close',c=>{codeA=c});
  const pB=await open(port,'publisher','camX');pB.on('close',c=>{codeB=c});await wait(200);
  assert(codeA===null&&pA.readyState===1,'le premier téléphone reste connecté');
  assert(codeB===4001,'le nouveau est refusé avec le code 4001, reçu : '+codeB);
  assert(pO.readyState===1,'une autre caméra reste connectée');
  pO.close();pA.close();
  /* statistiques : le téléphone et OBS les envoient, le PC les lit via /info */
  const sp=await open(port,'publisher','camS'),sv=await open(port,'viewer','camS');
  sp.send(JSON.stringify({type:'stats',cam:2,fps:30,mbps:2.9,res:'1280×720<b>',rssi:-58,battery:80,charging:true,hack:'x'}));
  sv.send(JSON.stringify({type:'vstats',fps:29,jitter:4,lost:0}));await wait(150);
  const info=await new Promise(r=>require('http').get('http://127.0.0.1:'+port+'/info',x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(JSON.parse(b)))}));
  const rm=info.rooms.find(x=>x.room==='camS');
  assert(rm&&rm.stats.fps===30&&rm.stats.rssi===-58&&rm.stats.charging===true,'stats du téléphone lues');
  assert(rm.stats.res==='1280×720b'&&!('hack' in rm.stats),'stats nettoyées');
  assert(rm.vstats.fps===29,'stats OBS lues');
  assert(typeof info.cpu==='number','charge processeur du PC');
  sp.close();sv.close();
  /* « à l'antenne » : OBS (viewer) l'annonce, le téléphone (publisher) le reçoit ; seul OBS peut l'affirmer */
  const aP=await open(port,'publisher','camA'),aV=await open(port,'viewer','camA'),aO=await open(port,'publisher','camB'),aW=await open(port,'viewer','camB');
  await wait(100);
  const lastAir=w=>{const l=w.q.filter(m=>m.type==='onair');return l.length?l[l.length-1].value:undefined};
  assert(lastAir(aP)===false,'téléphone : pas à l\'antenne au départ');
  aV.send(JSON.stringify({type:'onair',value:true}));await wait(100);
  assert(lastAir(aP)===true,'téléphone prévenu : à l\'antenne');
  assert(lastAir(aO)===false,'l\'autre téléphone reste « pas à l\'antenne »');
  aP.send(JSON.stringify({type:'onair',value:false}));await wait(100);
  assert(lastAir(aP)===true,'un téléphone ne peut pas changer son propre statut');
  const cV=await open(port,'viewer','camC');cV.send(JSON.stringify({type:'onair',value:true}));await wait(100);
  const late=await open(port,'publisher','camC');await wait(100);
  assert(lastAir(late)===true,'un téléphone qui arrive en cours de direct reçoit le statut');
  late.close();cV.close();
  aV.send(JSON.stringify({type:'onair',value:false}));await wait(100);
  assert(lastAir(aP)===false,'téléphone prévenu : plus à l\'antenne');
  aV.send(JSON.stringify({type:'onair',value:true}));await wait(100);
  let infoA=await new Promise(r=>require('http').get('http://127.0.0.1:'+port+'/info',x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(JSON.parse(b)))}));
  assert(infoA.rooms.find(x=>x.room==='camA').onair===true&&infoA.rooms.find(x=>x.room==='camB').onair===false,'/info indique la caméra à l\'antenne');
  aV.close();await wait(100);
  infoA=await new Promise(r=>require('http').get('http://127.0.0.1:'+port+'/info',x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(JSON.parse(b)))}));
  assert(infoA.rooms.find(x=>x.room==='camA').onair===false,'OBS déconnecté : plus à l\'antenne');
  aP.close();aO.close();aW.close();
  console.log('OK signalisation');
  other.close();
  pub=await open(port,'publisher','e2e');
  const src=new RTCVideoSource(),track=src.createTrack(),W=320,H=240;
  const timer=setInterval(()=>src.onFrame({width:W,height:H,data:new Uint8ClampedArray(W*H*1.5).fill(128)}),66);
  let ppc,frames=0;
  pub.h=async m=>{
    if(m.type==='viewer-joined'){ppc=new RTCPeerConnection({iceServers:[]});
      ppc.onicecandidate=e=>e.candidate&&pub.send(JSON.stringify({type:'candidate',candidate:e.candidate}));
      ppc.addTrack(track);const o=await ppc.createOffer();await ppc.setLocalDescription(o);pub.send(JSON.stringify({type:'offer',sdp:o.sdp}));}
    else if(m.type==='answer')await ppc.setRemoteDescription({type:'answer',sdp:m.sdp});
    else if(m.type==='candidate')await ppc.addIceCandidate(m.candidate);
  };
  const vw=await open(port,'viewer','e2e');let vpc;
  vw.h=async m=>{
    if(m.type==='offer'){vpc=new RTCPeerConnection({iceServers:[]});
      vpc.onicecandidate=e=>e.candidate&&vw.send(JSON.stringify({type:'candidate',candidate:e.candidate}));
      vpc.ontrack=e=>{new RTCVideoSink(e.track).onframe=()=>frames++};
      await vpc.setRemoteDescription({type:'offer',sdp:m.sdp});const a=await vpc.createAnswer();await vpc.setLocalDescription(a);vw.send(JSON.stringify({type:'answer',sdp:a.sdp}));}
    else if(m.type==='candidate')await vpc.addIceCandidate(m.candidate);
  };
  for(let i=0;i<50&&frames<30;i++)await wait(200);
  clearInterval(timer);
  assert(frames>=30,'images reçues: '+frames);
  console.log('OK WebRTC de bout en bout, images reçues:',frames);
  process.exit(0);
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
