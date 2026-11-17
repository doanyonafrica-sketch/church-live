/* Test d'aptitude d'un téléphone, de bout en bout : démarrage depuis le PC, mesures, verdict, coupures, arrêt, protection */
const assert=require('assert'),WebSocket=require('ws'),http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
const {createServer}=require('../server');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
/* faux téléphone ; s'il est « speedy », il répond à la demande d'essai de débit comme la vraie application */
const open=(port,role,room,id,opt)=>new Promise(r=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws',opt||{});w.q=[];
  w.on('message',d=>{const m=JSON.parse(d);w.q.push(m);
    if(m.type==='speedtest'&&w.speedy){const pad='x'.repeat(80000);for(let i=0;i<12;i++)w.send(JSON.stringify({type:'speed',i,pad}));w.send(JSON.stringify({type:'speed-end'}))}});
  w.on('open',()=>{w.send(JSON.stringify({type:'join',role,room,id}));r(w)})});
const req=(port,method,p,body,headers={})=>new Promise(res=>{
  const data=body===undefined?null:JSON.stringify(body);
  const q=http.request({host:'127.0.0.1',port,path:p,method,headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...headers}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{let j=null;try{j=JSON.parse(b)}catch{}res({status:r.statusCode,json:j})})});
  q.on('error',()=>res({status:0}));if(data)q.write(data);q.end()});
const good={type:'stats',fps:30,mbps:4.2,rtt:9,loss:0,res:'1280×720',limit:'none',level:'ok',thermal:0,battery:80,charging:true,rssi:-60,link:150,freq:5200,codec:'h264'};
const room=(info,r)=>info.json.rooms.find(x=>x.room===r);
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apt-'));
  const srv=createServer({grace:300,cameras:false,dataDir:dir,testMs:1800,snapMs:50});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
  const start=r=>req(port,'POST','/api/test/'+r+'/start',{}),stop=r=>req(port,'POST','/api/test/'+r+'/stop',{});

  /* sans téléphone connecté : refusé */
  let r=await start('camA');assert(r.status===404&&!r.json.ok,'pas de téléphone, pas de test');
  /* protection : un appareil du réseau (en-tête Origin étranger) ne peut pas lancer de test */
  r=await req(port,'POST','/api/test/camA/start',{},{Origin:'http://evil.example'});assert(r.status===403||r.status===404,'origine étrangère refusée');

  /* bon téléphone : verdict « apte » */
  const p=await open(port,'publisher','camA');p.send(JSON.stringify({type:'log',items:[{ev:'device',d:{ua:'Mozilla/5.0 (Linux; Android 10; moto g pure Build/QPH30) Chrome',cores:8,ram:4},ago:0}]}));
  p.speedy=true;const feed=setInterval(()=>{if(p.readyState===1)p.send(JSON.stringify(good))},20);
  await wait(150);
  r=await start('camA');assert(r.status===200&&r.json.ok,'test démarré');
  await wait(200);let info=await req(port,'GET','/info');let t=room(info,'camA').test;
  assert(t&&t.running&&t.elapsed>0&&t.dur===1800&&!t.result,'test en cours visible dans /info');
  await wait(2300);
  info=await req(port,'GET','/info');t=room(info,'camA').test;
  assert(t&&!t.running&&t.result,'test terminé');
  assert.strictEqual(t.result.verdict,'apte','bon téléphone branché : apte, obtenu '+t.result.verdict+' '+JSON.stringify(t.result.checks.filter(c=>c.status!=='ok')));
  assert(/moto g pure/.test(t.result.device),'modèle du téléphone repris dans le verdict');
  assert(t.result.fig.speed>=1&&t.result.checks.some(c=>c.key==='speed'&&c.status==='ok'),'débit vers le PC mesuré pendant le test (obtenu '+t.result.fig.speed+')');
  assert(t.result.cause&&t.result.cause.kind==='ok'&&t.result.fig.band==='5','bon téléphone : aucun problème, bande 5 GHz');
  clearInterval(feed);p.close();await wait(100);

  /* mauvais téléphone : « non apte », avec conseils */
  const b=await open(port,'publisher','camB');
  const feedB=setInterval(()=>{if(b.readyState===1)b.send(JSON.stringify({...good,fps:12,rtt:700,level:'bad'}))},20);await wait(150);
  r=await start('camB');assert(r.json.ok);await wait(2400);
  info=await req(port,'GET','/info');t=room(info,'camB').test;
  assert(t.result&&t.result.verdict==='non'&&t.result.advice.length>0,'téléphone qui rame : non apte avec conseils');
  assert(t.result.cause.kind==='network'&&t.result.cause.proof,'latence élevée en 5 GHz : cause réseau, avec la preuve à faire');
  clearInterval(feedB);b.close();await wait(100);

  /* coupure pendant le test : comptée */
  const c=await open(port,'publisher','camC');const feedC=setInterval(()=>{if(c.readyState===1)c.send(JSON.stringify(good))},20);await wait(150);
  r=await start('camC');await wait(300);c.terminate();await wait(150);
  const c2=await open(port,'publisher','camC');const feedC2=setInterval(()=>{if(c2.readyState===1)c2.send(JSON.stringify(good))},20);
  await wait(300);info=await req(port,'GET','/info');t=room(info,'camC').test;
  assert(t&&t.drops>=1,'coupure comptée pendant le test');
  /* arrêt anticipé : verdict « test trop court » */
  r=await stop('camC');assert(r.status===200&&r.json.ok,'arrêt accepté');
  info=await req(port,'GET','/info');t=room(info,'camC').test;
  assert(t.result&&t.result.verdict==='insuffisant','arrêt anticipé : test trop court');
  r=await stop('camZ');assert(r.status===404,'arrêt sans test');
  r=await req(port,'POST','/api/test/camC/boum',{});assert(r.status===400,'action inconnue refusée');
  clearInterval(feedC2);c2.close();

  /* changement d'adresse IP pendant un test = reconnexion au Wi-Fi : détecté et compté */
  const e1=await open(port,'publisher','camE','tel001');e1.speedy=true;const feedE1=setInterval(()=>{if(e1.readyState===1)e1.send(JSON.stringify(good))},20);await wait(150);
  r=await start('camE');assert(r.json.ok);await wait(300);
  clearInterval(feedE1);
  const e2=await open(port,'publisher','camE','tel001',{localAddress:'127.0.0.2'});e2.speedy=true;const feedE2=setInterval(()=>{if(e2.readyState===1)e2.send(JSON.stringify(good))},20);
  await wait(2400);info=await req(port,'GET','/info');t=room(info,'camE').test;
  assert(t&&t.result,'test terminé après le changement d\'adresse');
  const ipc=t.result.checks.find(c=>c.key==='ip');assert(ipc&&ipc.status==='warn'&&t.result.fig.ipChanges===1,'un changement d\'adresse IP compté ('+JSON.stringify(ipc)+')');
  clearInterval(feedE2);e2.close();await wait(100);

  /* durée choisie : 5 min par défaut, 10 min sur demande, autre valeur ignorée */
  const srv2=createServer({grace:300,cameras:false});await new Promise(r=>srv2.listen(0,'127.0.0.1',r));const port2=srv2.address().port;
  const d=await open(port2,'publisher','camD');await wait(100);
  const dur=async body=>{await req(port2,'POST','/api/test/camD/start',body);const i=await req(port2,'GET','/info');return room(i,'camD').test.dur};
  assert.strictEqual(await dur({}),300000,'5 minutes par défaut');
  assert.strictEqual(await dur({minutes:10}),600000,'10 minutes sur demande');
  assert.strictEqual(await dur({minutes:99}),300000,'durée inconnue : 5 minutes');
  d.close();srv2.close();

  /* le verdict est noté dans le journal */
  await wait(200);
  const files=fs.readdirSync(path.join(dir,'journal'));const lines=fs.readFileSync(path.join(dir,'journal',files[0]),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  assert(lines.some(l=>l.ev==='test-start'&&l.room==='camA'),'début de test journalisé');
  const tr=lines.filter(l=>l.ev==='test-result');assert(tr.length>=3&&tr.some(l=>l.room==='camA'&&l.verdict==='apte')&&tr.some(l=>l.room==='camB'&&l.verdict==='non'),'verdicts journalisés');
  assert(tr.some(l=>l.room==='camA'&&l.band==='5'&&l.ckind==='ok'&&typeof l.speed==='number'),'bande, cause et débit journalisés');
  assert(lines.some(l=>l.ev==='speedtest'&&l.room==='camA'&&l.mbps>0),'essai de débit journalisé');
  srv.close();console.log('OK test d\'aptitude (démarrage, verdicts, coupures, arrêt, protection, journal)');process.exit(0);
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
