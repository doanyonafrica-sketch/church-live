/* Places, refus des intrus et code d'appairage (sans WebRTC : ne dépend que de ws) */
const assert=require('assert'),WebSocket=require('ws'),http=require('http');
const {createServer}=require('../server');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const open=(port,join)=>new Promise(r=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws');w.q=[];w.code=null;w.on('message',d=>w.q.push(JSON.parse(d)));w.on('close',c=>{w.code=c});w.on('open',()=>{w.send(JSON.stringify({type:'join',...join}));r(w)})});
(async()=>{
  const srv=createServer({grace:300,cameras:false});await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
  /* un 2e viewer (autre onglet, autre source OBS) ne chasse pas le premier : plus de boucle qui coupe le flux */
  const v1=await open(port,{role:'viewer',room:'r',id:'A'}),v2=await open(port,{role:'viewer',room:'r',id:'B'});await wait(150);
  assert(v1.code===null&&v1.readyState===1,'le 1er viewer reste connecté');
  assert(v2.code===4001&&v2.q.some(m=>m.type==='busy'),'le 2e viewer est refusé (4001), reçu : '+v2.code);
  /* même appareil qui revient (même id) : il reprend sa place, l'ancienne connexion reçoit 4000 */
  const v1b=await open(port,{role:'viewer',room:'r',id:'A'});await wait(150);
  assert(v1.code===4000,'ancienne connexion du même appareil fermée avec 4000, reçu : '+v1.code);
  assert(v1b.readyState===1,'le même appareil a repris sa place');
  /* une fois la place libre, un autre appareil peut la prendre */
  v1b.close();await wait(100);
  const v3=await open(port,{role:'viewer',room:'r',id:'C'});await wait(100);
  assert(v3.readyState===1&&v3.code===null,'place libérée : acceptée');
  v3.close();srv.shutdown();
  /* code d'appairage : les appareils distants doivent le fournir, le PC lui-même (127.0.0.1) non */
  const s2=createServer({grace:300,cameras:false,pin:'123456'});await new Promise(r=>s2.listen(0,r));const p2=s2.address().port;
  const loc=await open(p2,{role:'viewer',room:'p',id:'L'});await wait(100);
  assert(loc.readyState===1&&loc.code===null,'le PC (127.0.0.1) n\'a pas besoin du code');
  const info=await new Promise(r=>http.get('http://127.0.0.1:'+p2+'/info',x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(JSON.parse(b)))}));
  assert(info.pin==='123456','la fenêtre du PC reçoit le code');
  loc.close();s2.shutdown();
  console.log('pairing OK');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
