/* Alerte Wi-Fi 2,4 GHz : détection en continu, bouton « Prévenir le téléphone », nom du réseau, journal, protection */
const assert=require('assert'),WebSocket=require('ws'),http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
const {createServer}=require('../server');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const open=(port,room,id)=>new Promise(r=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws');w.q=[];w.on('message',d=>w.q.push(JSON.parse(d)));
  w.on('open',()=>{w.send(JSON.stringify({type:'join',role:'publisher',room,id}));r(w)})});
const req=(port,method,p,headers={},body)=>new Promise(res=>{const data=body===undefined?null:JSON.stringify(body);const q=http.request({host:'127.0.0.1',port,path:p,method,headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...headers}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{let j=null;try{j=JSON.parse(b)}catch{}res({status:r.statusCode,json:j})})});q.on('error',()=>res({status:0}));if(data)q.write(data);q.end()});
const room=(info,r)=>info.json.rooms.find(x=>x.room===r);
const bad24={type:'stats',fps:12,mbps:1,rtt:600,loss:2,res:'1280×720',limit:'none',level:'bad',thermal:0,battery:80,charging:true,rssi:-45,link:39,freq:2437,ssid:'Eglise-2G',codec:'h264'};
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wifi-'));
  const srv=createServer({grace:300,cameras:false,dataDir:dir,snapMs:50});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;

  /* sans téléphone : refusé ; origine étrangère : refusée */
  let r=await req(port,'POST','/api/notice/camA');assert(r.status===404&&!r.json.ok,'pas de téléphone, pas de demande');
  r=await req(port,'POST','/api/notice/camA',{Origin:'http://evil.example'});assert(r.status===403||r.status===404,'origine étrangère refusée');

  /* téléphone en 2,4 GHz avec une mauvaise connexion : alerte au bout de quelques mesures */
  const p=await open(port,'camA','wifi-tel1');
  let feed=setInterval(()=>{if(p.readyState===1)p.send(JSON.stringify(bad24))},20);
  await wait(60);let info=await req(port,'GET','/info');let w=room(info,'camA').wifi;
  assert(w&&w.band==='2,4'&&w.ssid==='Eglise-2G'&&w.link===39,'bande et nom du réseau lus ('+JSON.stringify(w)+')');
  assert(!w.trouble,'pas d\'alerte tout de suite (il faut une connexion mauvaise pendant plusieurs mesures)');
  await wait(400);info=await req(port,'GET','/info');w=room(info,'camA').wifi;
  assert(w.trouble&&!w.guess&&w.since,'alerte Wi-Fi 2,4 GHz déclenchée');

  /* « Prévenir le téléphone » : le téléphone reçoit la demande */
  r=await req(port,'POST','/api/notice/camA');assert(r.status===200&&r.json.ok,'demande acceptée');
  await wait(100);assert(p.q.some(m=>m.type==='notice'&&m.kind==='wifi5'),'le téléphone a reçu la demande de passer au 5 GHz');
  info=await req(port,'GET','/info');assert(room(info,'camA').wifi.noticed,'heure de la demande visible dans /info');
  assert(p.q.find(m=>m.type==='notice').net5==='','sans nom de réseau saisi : demande générique');
  /* avec le nom du réseau 5 GHz saisi sur le PC : transmis au téléphone, nettoyé et limité en taille */
  r=await req(port,'POST','/api/notice/camA',{},{net5:'  <b>Eglise-5G</b>"\''+'z'.repeat(60)});assert(r.status===200,'demande avec nom de réseau acceptée');
  await wait(100);const n2=p.q.filter(m=>m.type==='notice').pop();assert(/^bEglise-5G\/bz+$/.test(n2.net5)&&n2.net5.length<=32&&!/[<>"']/.test(n2.net5),'nom du réseau 5 GHz nettoyé et limité à 32 caractères ('+n2.net5+')');
  r=await req(port,'POST','/api/notice/camA',{},{net5:'Eglise-5G'});await wait(100);assert(p.q.filter(m=>m.type==='notice').pop().net5==='Eglise-5G','nom du réseau 5 GHz transmis au téléphone');

  /* le téléphone passe au 5 GHz et la connexion redevient bonne : l'alerte s'arrête */
  clearInterval(feed);feed=setInterval(()=>{if(p.readyState===1)p.send(JSON.stringify({...bad24,freq:5200,level:'ok',rtt:9,fps:30,link:200,ssid:'Eglise-5G'}))},20);
  await wait(300);info=await req(port,'GET','/info');w=room(info,'camA').wifi;
  assert(!w.trouble&&w.band==='5'&&w.ssid==='Eglise-5G','alerte levée après le passage au 5 GHz');
  clearInterval(feed);p.close();await wait(100);

  /* bande inconnue (ancien APK) mais vitesse de liaison typique du 2,4 GHz : alerte « déduite » */
  const g=await open(port,'camG','wifi-tel2');const {freq,ssid,...noBand}=bad24;
  const feedG=setInterval(()=>{if(g.readyState===1)g.send(JSON.stringify(noBand))},20);await wait(500);
  info=await req(port,'GET','/info');w=room(info,'camG').wifi;assert(w.trouble&&w.guess&&w.band===null,'alerte déduite de la vitesse de liaison');
  clearInterval(feedG);g.close();await wait(100);

  /* le nom du réseau est nettoyé (aucun HTML) et limité en taille */
  const h=await open(port,'camH','wifi-tel3');h.send(JSON.stringify({...bad24,ssid:'<b>x</b>"\''+'y'.repeat(80)}));await wait(100);
  info=await req(port,'GET','/info');w=room(info,'camH').wifi;assert(w.ssid&&!/[<>"']/.test(w.ssid)&&w.ssid.length<=32,'nom du réseau nettoyé');
  h.close();await wait(100);

  /* le journal garde l'alerte, la demande et le nom du réseau */
  await wait(200);
  const files=fs.readdirSync(path.join(dir,'journal'));const lines=fs.readFileSync(path.join(dir,'journal',files[0]),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  assert(lines.some(l=>l.ev==='wifi24-alert'&&l.room==='camA'&&l.ssid==='Eglise-2G'&&l.guess===false),'alerte journalisée');
  assert(lines.some(l=>l.ev==='wifi24-alert'&&l.room==='camG'&&l.guess===true),'alerte déduite journalisée');
  assert(lines.some(l=>l.ev==='notice-sent'&&l.room==='camA'&&l.net5==='Eglise-5G'),'demande au téléphone journalisée, avec le nom du réseau');
  assert(lines.some(l=>l.ev==='snap'&&l.room==='camA'&&l.ssid==='Eglise-2G'),'nom du réseau dans les mesures');
  srv.close();console.log('OK alerte Wi-Fi 2,4 GHz (détection, demande au téléphone, nom du réseau, journal, protection)');process.exit(0);
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
