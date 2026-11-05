/* Test des caméras : fausse caméra ONVIF (mot de passe haché vérifié) + API du PC + flux vidéo (ffmpeg) */
const assert=require('assert'),http=require('http'),crypto=require('crypto'),os=require('os'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const {createServer}=require('../server');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const USER='admin',PASS='s3cret!',RTSP_PORT=18554;
const log=[];
/* Fausse caméra : refuse tout appel sans bon mot de passe haché (sauf l'heure), horloge décalée de 2 h */
const cam=http.createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{
  const x=n=>(new RegExp('<(?:\\w+:)?'+n+'\\b[^>]*>([^<]*)<').exec(b)||[])[1];
  const env=body=>r.end('<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Body>'+body+'</s:Body></s:Envelope>');
  const fault=t=>{r.statusCode=400;env('<s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code><s:Reason><s:Text>'+t+'</s:Text></s:Reason></s:Fault>')};
  const op=(/<s:Body>\s*<(?:\w+:)?(\w+)/.exec(b)||[])[1];
  const skew=2*3600e3;
  if(op==='GetSystemDateAndTime'){const d=new Date(Date.now()+skew);return env('<tds:GetSystemDateAndTimeResponse xmlns:tds="d"><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>'+d.getUTCHours()+'</tt:Hour><tt:Minute>'+d.getUTCMinutes()+'</tt:Minute><tt:Second>'+d.getUTCSeconds()+'</tt:Second></tt:Time><tt:Date><tt:Year>'+d.getUTCFullYear()+'</tt:Year><tt:Month>'+(d.getUTCMonth()+1)+'</tt:Month><tt:Day>'+d.getUTCDate()+'</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>')}
  const nonce=x('Nonce'),created=x('Created'),dig=x('Password');
  const want=nonce&&crypto.createHash('sha1').update(Buffer.concat([Buffer.from(nonce,'base64'),Buffer.from(created+PASS)])).digest('base64');
  const drift=created?Math.abs(Date.parse(created)-(Date.now()+skew)):1e9;
  if(x('Username')!==USER||dig!==want||drift>60e3)return fault('Sender not Authorized');
  log.push(op+(op==='ContinuousMove'?':'+/PanTilt x="([^"]+)" y="([^"]+)"/.exec(b).slice(1).join(','):'')+(op==='GotoPreset'?':'+x('PresetToken'):''));
  const base='http://127.0.0.1:'+cam.address().port;
  switch(op){
    case'GetCapabilities':return env('<tds:GetCapabilitiesResponse xmlns:tds="d"><tds:Capabilities><tt:Media><tt:XAddr>http://10.9.9.9:'+cam.address().port+'/onvif/media_service</tt:XAddr></tt:Media><tt:PTZ><tt:XAddr>'+base+'/onvif/ptz_service</tt:XAddr></tt:PTZ></tds:Capabilities></tds:GetCapabilitiesResponse>');
    case'GetDeviceInformation':return env('<tds:GetDeviceInformationResponse xmlns:tds="d"><tds:Manufacturer>FakeCam</tds:Manufacturer><tds:Model>Dome-X</tds:Model><tds:FirmwareVersion>1.2</tds:FirmwareVersion></tds:GetDeviceInformationResponse>');
    case'GetProfiles':return env('<trt:GetProfilesResponse xmlns:trt="m"><trt:Profiles token="main" fixed="true"><tt:Name>mainStream</tt:Name><tt:VideoEncoderConfiguration><tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration><tt:PTZConfiguration token="p"><tt:Name>ptz</tt:Name></tt:PTZConfiguration></trt:Profiles><trt:Profiles token="sub" fixed="true"><tt:Name>subStream</tt:Name><tt:VideoEncoderConfiguration><tt:Resolution><tt:Width>640</tt:Width><tt:Height>360</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles></trt:GetProfilesResponse>');
    case'GetStreamUri':return env('<trt:GetStreamUriResponse xmlns:trt="m"><trt:MediaUri><tt:Uri>rtsp://10.9.9.9:'+RTSP_PORT+'/'+x('ProfileToken')+'</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>');
    case'GetPresets':return env('<tptz:GetPresetsResponse xmlns:tptz="p"><tptz:Preset token="1"><tt:Name>Autel</tt:Name></tptz:Preset><tptz:Preset token="2"><tt:Name>Chorale</tt:Name></tptz:Preset></tptz:GetPresetsResponse>');
    case'SetPreset':return env('<tptz:SetPresetResponse xmlns:tptz="p"><tptz:PresetToken>3</tptz:PresetToken></tptz:SetPresetResponse>');
    default:return env('<x:'+op+'Response xmlns:x="x"/>');
  }})});
const api=(port,method,url,body)=>new Promise((res,rej)=>{const d=body?JSON.stringify(body):null;
  const q=http.request({host:'127.0.0.1',port,path:url,method,headers:d?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)}:{}},r=>{let t='';r.on('data',c=>t+=c);r.on('end',()=>{let j;try{j=JSON.parse(t)}catch{}res({status:r.statusCode,json:j})})});
  q.on('error',rej);q.end(d)});
(async()=>{
  await new Promise(r=>cam.listen(0,'127.0.0.1',r));const cp=cam.address().port;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tpr-cam-'));
  const srv=createServer({dataDir:dir});await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
  let r;
  r=await api(port,'POST','/api/cameras',{name:'Dôme',host:'8.8.8.8'});assert.strictEqual(r.status,400,'adresse Internet refusée');
  r=await api(port,'POST','/api/cameras',{name:'Dôme',host:'nimportequoi'});assert.strictEqual(r.status,400,'nom de domaine refusé');
  /* détection : mauvais mot de passe, puis bon, avec recherche du port */
  r=await api(port,'POST','/api/cameras/probe',{host:'127.0.0.1',port:cp,user:USER,pass:'faux'});
  assert.strictEqual(r.status,401,'mauvais mot de passe : 401, reçu '+r.status);assert(/mot de passe/.test(r.json.error));
  r=await api(port,'POST','/api/cameras/probe',{host:'127.0.0.1',port:cp,user:USER,pass:PASS});
  assert(r.json.ok,JSON.stringify(r.json));assert(r.json.ptz===true,'PTZ détecté');assert.strictEqual(r.json.resolution,'1920×1080');
  assert.strictEqual(r.json.info.model,'Dome-X');
  assert(/^rtsp:\/\/admin:s3cret!@127\.0\.0\.1:\d+\/main$/.test(r.json.rtsp),'adresse RTSP corrigée (127.0.0.1) avec identifiants : '+r.json.rtsp);
  console.log('OK détection ONVIF (horloge décalée, mot de passe haché, adresses corrigées)');
  /* enregistrement */
  r=await api(port,'POST','/api/cameras',{name:'Dôme 1',host:'127.0.0.1',port:cp,user:USER,pass:PASS});assert(r.json.ok);const id=r.json.camera.id;
  assert(r.json.camera.hasPass===true&&!('pass' in r.json.camera),'mot de passe jamais renvoyé');
  r=await api(port,'GET','/api/cameras');assert.strictEqual(r.json.length,1);assert(!JSON.stringify(r.json).includes(PASS),'liste sans mot de passe');
  assert(fs.readFileSync(path.join(dir,'cameras.json'),'utf8').includes(PASS),'mot de passe conservé sur le disque');
  /* PTZ */
  log.length=0;
  r=await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'move',x:-0.5,y:0.3,z:0});assert(r.json.ok,JSON.stringify(r.json));
  assert(log.includes('ContinuousMove:-0.5,0.3'),'ContinuousMove reçu : '+log);
  r=await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'move',x:9,y:-9,z:0});
  assert(log.includes('ContinuousMove:1,-1'),'vitesse limitée à [-1;1] : '+log);
  await wait(1900);assert(log.includes('Stop'),'arrêt automatique si « stop » ne vient jamais');
  log.length=0;await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'move',x:1,y:0,z:0});
  await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'stop'});log.length=0;await wait(1900);
  assert(!log.includes('Stop'),'pas de second arrêt après un « stop » explicite');
  r=await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'presets'});assert.deepStrictEqual(r.json.presets.map(p=>p.name),['Autel','Chorale']);
  log.length=0;await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'goto',token:'2'});assert(log.includes('GotoPreset:2'));
  r=await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'save',name:'Prédication'});assert.strictEqual(r.json.token,'3');
  console.log('OK commandes PTZ (déplacement, arrêt auto, positions mémorisées)');
  /* flux vidéo : nécessite un serveur RTSP de test (MEDIAMTX=chemin de l'exécutable) ; sinon cette partie est ignorée */
  if(process.env.MEDIAMTX){
    const cfg=path.join(dir,'mtx.yml');fs.writeFileSync(cfg,'rtspAddress: :'+RTSP_PORT+'\nrtmp: no\nhls: no\nwebrtc: no\nsrt: no\napi: no\nmetrics: no\npprof: no\nplayback: no\npaths:\n  all_others:\n');
    const mtx=spawn(process.env.MEDIAMTX,[cfg],{stdio:'ignore'});
    await wait(1000);
    const pushr=spawn('ffmpeg',['-loglevel','error','-re','-f','lavfi','-i','testsrc=size=640x360:rate=15','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-g','15','-f','rtsp','-rtsp_transport','tcp','rtsp://127.0.0.1:'+RTSP_PORT+'/sub'],{stdio:'ignore'});
    await wait(1500);
    const got=await new Promise(res=>{let n=0,b=Buffer.alloc(0);const q=http.get({host:'127.0.0.1',port,path:'/api/cameras/'+id+'/stream.mjpg'},x=>{
      x.on('data',d=>{b=Buffer.concat([b,d]);n=(b.toString('latin1').match(/\xff\xd8/g)||[]).length;if(n>=3){q.destroy();res({n,type:x.headers['content-type']})}});
      setTimeout(()=>{q.destroy();res({n,err:true})},14000)});q.on('error',()=>{})});
    pushr.kill();mtx.kill();
    assert(!got.err&&got.n>=3,'images JPEG reçues : '+JSON.stringify(got));
    console.log('OK flux vidéo RTSP → MJPEG,',got.n,'images');
  }else console.log('(flux vidéo non testé : définir MEDIAMTX)');
  /* modification, suppression */
  r=await api(port,'PUT','/api/cameras/'+id,{name:'Chœur'});assert.strictEqual(r.json.camera.name,'Chœur');
  r=await api(port,'POST','/api/cameras/'+id+'/ptz',{action:'presets'});assert(r.json.ok,'mot de passe conservé après modification sans mot de passe');
  r=await api(port,'DELETE','/api/cameras/'+id);assert(r.json.ok);
  r=await api(port,'GET','/api/cameras');assert.strictEqual(r.json.length,0);
  /* sans caméra, le serveur de direct reste intact */
  r=await api(port,'GET','/info');assert.strictEqual(r.json.app,'tpr-live');
  console.log('OK gestion des caméras');
  srv.close();cam.close();process.exit(0);
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
