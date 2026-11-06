/* Caméras IP (dômes / PTZ) : commande par ONVIF et image en direct dans la fenêtre du PC.
   - ONVIF : protocole standard compris par la grande majorité des caméras IP (Hikvision, Dahua, TP-Link Tapo, Reolink, Axis, V380 Pro, etc.).
   - Image : le flux RTSP de la caméra est converti en MJPEG par ffmpeg (navigateurs et Electron ne lisent pas le RTSP).
   Tout est réservé au PC lui-même (127.0.0.1) : un téléphone du réseau ne peut ni lire ni modifier les caméras. */
const http=require('http'),net=require('net'),crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');

/* ───────────── Sécurité ───────────── */
/* On n'accepte que des adresses du réseau local : le serveur ne doit pas pouvoir être utilisé pour joindre Internet. */
const isLan=h=>{const m=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(h||''));if(!m)return false;
  const [a,b,c,d]=m.slice(1).map(Number);if([a,b,c,d].some(n=>n>255))return false;
  return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254)};
const isLocalReq=q=>{const a=q.socket.remoteAddress||'';return a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1'};

/* ───────────── XML minimal (pas de dépendance) ───────────── */
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const tag=(x,n)=>{const m=new RegExp('<(?:[\\w-]+:)?'+n+'\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?'+n+'>').exec(x);return m?m[1].trim():null};
const attr=(a,n)=>{const m=new RegExp('\\b'+n+'="([^"]*)"').exec(a);return m?m[1]:null};
const all=(x,n)=>{const re=new RegExp('<(?:[\\w-]+:)?'+n+'\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?'+n+'>)','g'),o=[];let m;while((m=re.exec(x)))o.push({attrs:m[1]||'',body:m[2]||''});return o};
const unesc=s=>String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");

/* Vérifie vite (1,5 s) qu'un port répond, pour ne pas attendre 6 s par port sur une adresse injoignable */
const tcpOpen=(host,port,ms=1500)=>new Promise(res=>{const s=net.connect({host,port,timeout:ms});
  const done=v=>{s.destroy();res(v)};s.on('connect',()=>done(true)).on('timeout',()=>done(false)).on('error',()=>done(false))});

/* ───────────── Client ONVIF ───────────── */
const NS='xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"';
const WSSE='http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',WSU='http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',PW='http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#';
function header(user,pass,offset,mode){
  if(!user)return '';
  const nonce=crypto.randomBytes(16),created=new Date(Date.now()+(offset||0)).toISOString().replace(/\.\d+Z$/,'Z');
  const pw=mode==='text'?esc(pass):crypto.createHash('sha1').update(Buffer.concat([nonce,Buffer.from(created+pass)])).digest('base64');
  return '<s:Header><Security xmlns="'+WSSE+'" s:mustUnderstand="1"><UsernameToken><Username>'+esc(user)+'</Username><Password Type="'+PW+(mode==='text'?'PasswordText':'PasswordDigest')+'">'+pw+'</Password><Nonce EncodingType="'+WSSE.replace('secext-1.0.xsd','soap-message-security-1.0#Base64Binary')+'">'+nonce.toString('base64')+'</Nonce><Created xmlns="'+WSU+'">'+created+'</Created></UsernameToken></Security></s:Header>'}
function post(url,xml,timeout=6000){
  return new Promise((res,rej)=>{
    const u=new URL(url),q=http.request({hostname:u.hostname,port:u.port||80,path:u.pathname+u.search,method:'POST',timeout,
      headers:{'Content-Type':'application/soap+xml; charset=utf-8','Content-Length':Buffer.byteLength(xml)}},r=>{
      let b='';r.setEncoding('utf8');r.on('data',d=>{b+=d;if(b.length>2e6)q.destroy()});r.on('end',()=>res({status:r.statusCode,body:b}))});
    q.on('timeout',()=>q.destroy(new Error('La caméra ne répond pas (délai dépassé).')));
    q.on('error',e=>rej(e.code==='ECONNREFUSED'?new Error('Connexion refusée : mauvais port ?'):e.code==='EHOSTUNREACH'||e.code==='ENETUNREACH'?new Error('Caméra introuvable sur le réseau (adresse IP ?).'):e));
    q.end(xml)});
}
class OnvifError extends Error{constructor(m,auth){super(m);this.auth=!!auth}}
/* Appel SOAP : essaie le mot de passe haché (standard), puis en clair (certaines caméras anciennes). */
async function call(c,url,body){
  const modes=c.user?(c.mode?[c.mode]:['digest','text']):[null];let last;
  for(const mode of modes){
    const xml='<?xml version="1.0" encoding="utf-8"?><s:Envelope '+NS+'>'+header(c.user,c.pass,c.offset,mode)+'<s:Body>'+body+'</s:Body></s:Envelope>';
    const r=await post(url,xml);
    if(r.status>=200&&r.status<300&&!/<(?:\w+:)?Fault\b/.test(r.body)){if(mode)c.mode=mode;return r.body}
    const reason=unesc(tag(r.body,'Text')||tag(r.body,'Reason')||'');
    const auth=r.status===401||/NotAuthorized|Sender not Authorized|authoriz|authent/i.test(r.body);
    last=new OnvifError(auth?'Utilisateur ou mot de passe refusé par la caméra.':(reason||'Réponse inattendue de la caméra (HTTP '+r.status+').'),auth);
    if(!auth)break;
  }
  throw last;
}
/* Remplace l'adresse annoncée par la caméra (parfois fausse derrière un routeur) par celle qu'on connaît. */
const fixHost=(u,host)=>{try{const x=new URL(u);x.hostname=host;return x.toString()}catch{return u}};

/* Ouvre une session : décalage d'horloge, services Media/PTZ, profils, flux RTSP. */
async function open(cam){
  const c={host:cam.host,port:+cam.port||80,user:cam.user||'',pass:cam.pass||'',offset:0,mode:null};
  const dev='http://'+c.host+':'+c.port+'/onvif/device_service';
  try{const t=await post(dev,'<?xml version="1.0"?><s:Envelope '+NS+'><s:Body><tds:GetSystemDateAndTime/></s:Body></s:Envelope>');
    const u=tag(t.body,'UTCDateTime');if(u){const n=k=>+tag(tag(u,'Time')||'',k)||0,d=k=>+tag(tag(u,'Date')||'',k)||0;
      const ms=Date.UTC(d('Year'),d('Month')-1,d('Day'),n('Hour'),n('Minute'),n('Second'));if(ms>0)c.offset=ms-Date.now()}}
  catch(e){if(/Connexion|introuvable|délai/.test(e.message))throw e}
  let media=null,ptz=null,info={};
  try{const x=await call(c,dev,'<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>');
    const m=tag(x,'Media'),p=tag(x,'PTZ');media=m&&tag(m,'XAddr');ptz=p&&tag(p,'XAddr')}
  catch(e){if(e.auth)throw e}
  media=media?fixHost(unesc(media),c.host):'http://'+c.host+':'+c.port+'/onvif/media_service';
  ptz=ptz?fixHost(unesc(ptz),c.host):null;
  try{const x=await call(c,dev,'<tds:GetDeviceInformation/>');info={manufacturer:tag(x,'Manufacturer'),model:tag(x,'Model'),firmware:tag(x,'FirmwareVersion')}}catch{}
  const px=await call(c,media,'<trt:GetProfiles/>');
  const profiles=all(px,'Profiles').map(p=>{const w=+tag(tag(p.body,'Resolution')||'','Width')||0,h=+tag(tag(p.body,'Resolution')||'','Height')||0;
    return{token:attr(p.attrs,'token'),name:tag(p.body,'Name')||attr(p.attrs,'token'),w,h,ptz:/PTZConfiguration/.test(p.body)}}).filter(p=>p.token);
  if(!profiles.length)throw new OnvifError('La caméra n\'a renvoyé aucun profil vidéo.');
  const byRes=[...profiles].sort((a,b)=>b.w*b.h-a.w*a.h);
  const main=byRes[0],sub=byRes.find(p=>p.w*p.h>0&&p.w*p.h<main.w*main.h&&p.w>=320)||main;
  const uri=async p=>{try{const x=await call(c,media,'<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>'+esc(p.token)+'</trt:ProfileToken></trt:GetStreamUri>');
    return fixHost(unesc(tag(tag(x,'MediaUri')||x,'Uri')||''),c.host)||null}catch{return null}};
  const [rtspMain,rtspSub]=await Promise.all([uri(main),sub===main?null:uri(sub)]);
  const ptzProfile=profiles.find(p=>p.ptz)||main;
  return{c,media,ptz,info,profiles,main,sub,rtspMain,rtspSub:rtspSub||rtspMain,ptzToken:ptzProfile.token,canPtz:!!ptz&&profiles.some(p=>p.ptz)};
}
const withAuth=(u,user,pass)=>{if(!u)return null;try{const x=new URL(u);if(user){x.username=user;x.password=pass||''}return x.toString()}catch{return u}};

/* Commandes PTZ */
const clamp=v=>Math.max(-1,Math.min(1,+v||0));
const ptzCall=(s,body)=>{if(!s.ptz)throw new OnvifError('Cette caméra ne propose pas de commande de rotation (PTZ) par ONVIF.');return call(s.c,s.ptz,body)};
const T=s=>'<tptz:ProfileToken>'+esc(s.ptzToken)+'</tptz:ProfileToken>';
const PTZ={
  move:(s,x,y,z)=>ptzCall(s,'<tptz:ContinuousMove>'+T(s)+'<tptz:Velocity><tt:PanTilt x="'+clamp(x)+'" y="'+clamp(y)+'"/><tt:Zoom x="'+clamp(z)+'"/></tptz:Velocity></tptz:ContinuousMove>'),
  stop:s=>ptzCall(s,'<tptz:Stop>'+T(s)+'<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>'),
  home:s=>ptzCall(s,'<tptz:GotoHomePosition>'+T(s)+'</tptz:GotoHomePosition>'),
  goto:(s,tok)=>ptzCall(s,'<tptz:GotoPreset>'+T(s)+'<tptz:PresetToken>'+esc(tok)+'</tptz:PresetToken></tptz:GotoPreset>'),
  async presets(s){const x=await ptzCall(s,'<tptz:GetPresets>'+T(s)+'</tptz:GetPresets>');
    return all(x,'Preset').map(p=>({token:attr(p.attrs,'token'),name:unesc(tag(p.body,'Name')||'')||('Position '+attr(p.attrs,'token'))})).filter(p=>p.token)},
  async save(s,name,tok){const x=await ptzCall(s,'<tptz:SetPreset>'+T(s)+(name?'<tptz:PresetName>'+esc(name)+'</tptz:PresetName>':'')+(tok?'<tptz:PresetToken>'+esc(tok)+'</tptz:PresetToken>':'')+'</tptz:SetPreset>');
    return tag(x,'PresetToken')},
  remove:(s,tok)=>ptzCall(s,'<tptz:RemovePreset>'+T(s)+'<tptz:PresetToken>'+esc(tok)+'</tptz:PresetToken></tptz:RemovePreset>'),
};

/* ───────────── ffmpeg : RTSP → MJPEG ───────────── */
function ffmpegPath(){try{return require('ffmpeg-static').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep)}catch{return 'ffmpeg'}}
class Streams{
  constructor(){this.m=new Map()}
  add(id,url,res){
    let s=this.m.get(id);
    if(s&&s.url!==url){this.kill(id);s=null}
    if(!s){
      const p=spawn(ffmpegPath(),['-hide_banner','-loglevel','error','-rtsp_transport','tcp','-fflags','nobuffer','-flags','low_delay','-i',url,
        '-an','-vf','scale=960:-2','-r','10','-c:v','mjpeg','-q:v','6','-f','mpjpeg','-boundary_tag','frame','pipe:1'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
      s={url,p,clients:new Set(),err:'',got:false,timer:null};this.m.set(id,s);
      p.stdout.on('data',d=>{s.got=true;for(const r of s.clients){if(r.writableLength>1<<21){r.destroy();s.clients.delete(r)}else r.write(d)}});
      p.stderr.on('data',d=>{s.err=(s.err+d).slice(-600)});
      p.on('error',e=>{s.err=e.code==='ENOENT'?'ffmpeg introuvable':e.message});
      p.on('close',()=>{for(const r of s.clients)r.end();s.clients.clear();if(this.m.get(id)===s)this.m.delete(id)});
    }
    clearTimeout(s.timer);s.clients.add(res);
    res.on('close',()=>{s.clients.delete(res);if(!s.clients.size)s.timer=setTimeout(()=>this.kill(id,s),3000)});
  }
  kill(id,s=this.m.get(id)){if(!s)return;clearTimeout(s.timer);try{s.p.kill('SIGKILL')}catch{}if(this.m.get(id)===s)this.m.delete(id)}
  killAll(){for(const id of [...this.m.keys()])this.kill(id)}
}

/* ───────────── Stockage ───────────── */
function store(dir){
  const f=path.join(dir,'cameras.json');let list=[];
  try{list=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}
  if(!Array.isArray(list))list=[];
  const save=()=>{try{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(list,null,1));fs.renameSync(f+'.tmp',f)}catch(e){console.error('cameras.json :',e.message)}};
  return{list:()=>list,get:id=>list.find(x=>x.id===id),save,
    add(c){list.push(c);save()},del(id){list=list.filter(x=>x.id!==id);save()}};
}
const pub=c=>({id:c.id,name:c.name,host:c.host,port:c.port,user:c.user||'',hasPass:!!c.pass,rtsp:c.rtsp||'',ptz:c.ptz!==false});

/* ───────────── Routes HTTP ───────────── */
function mount(app,express,opts={}){
  const db=store(opts.dataDir||process.env.TPR_DATA||path.join(os.homedir(),'.tpr-live'));
  const streams=new Streams(),sessions=new Map(),stops=new Map();
  process.once('exit',()=>streams.killAll());   /* filet de sécurité : ffmpeg ne survit jamais à l'application */
  const bad=(r,code,msg)=>r.status(code).json({error:msg});
  const ok=(r,o={})=>r.json({ok:true,...o});
  const guard=(q,r,n)=>isLocalReq(q)?n():bad(r,403,'Réservé au PC qui exécute TPR Live.');
  const J=express.json({limit:'20kb'});
  const A='/api/cameras';
  const sess=async c=>{let s=sessions.get(c.id);
    if(s&&s.key===c.host+c.port+c.user+c.pass&&Date.now()-s.t<10*60e3)return s.v;
    const v=await open(c);sessions.set(c.id,{key:c.host+c.port+c.user+c.pass,t:Date.now(),v});return v};
  const wrap=h=>async(q,r)=>{try{await h(q,r)}catch(e){const c=q.params&&q.params.id;if(c)sessions.delete(c);bad(r,e.auth?401:502,e.message||'Erreur')}};
  const cam=(q,r)=>{const c=db.get(q.params.id);if(!c)bad(r,404,'Caméra inconnue.');return c};
  const fields=b=>{const host=String(b.host||'').trim(),port=Math.round(+b.port)||80;
    if(!isLan(host))return{error:'Saisissez l\'adresse IP de la caméra sur le réseau local (ex. 192.168.1.182).'};
    if(port<1||port>65535)return{error:'Port invalide.'};
    return{v:{name:String(b.name||'').trim().slice(0,60)||host,host,port,user:String(b.user||'').slice(0,80),pass:String(b.pass||'').slice(0,80),
      rtsp:/^rtsp:\/\//i.test(b.rtsp||'')?String(b.rtsp).slice(0,300):''}}};

  app.use(A,guard);
  app.get(A,(q,r)=>r.json(db.list().map(pub)));
  app.post(A,J,wrap(async(q,r)=>{const f=fields(q.body||{});if(f.error)return bad(r,400,f.error);
    if(db.list().length>=16)return bad(r,400,'16 caméras au maximum.');
    const c={id:crypto.randomBytes(5).toString('hex'),...f.v};db.add(c);ok(r,{camera:pub(c)})}));
  app.put(A+'/:id',J,wrap(async(q,r)=>{const c=cam(q,r);if(!c)return;const b=q.body||{};
    const f=fields({...c,...b,pass:b.pass===undefined||b.pass===''?c.pass:b.pass});if(f.error)return bad(r,400,f.error);
    Object.assign(c,f.v);db.save();sessions.delete(c.id);streams.kill(c.id);ok(r,{camera:pub(c)})}));
  app.delete(A+'/:id',wrap(async(q,r)=>{const c=cam(q,r);if(!c)return;streams.kill(c.id);sessions.delete(c.id);db.del(c.id);ok(r)}));

  /* Détection : essaie les ports ONVIF usuels puis renvoie ce que la caméra sait faire. */
  app.post(A+'/probe',J,wrap(async(q,r)=>{const b=q.body||{},f=fields(b);if(f.error)return bad(r,400,f.error);
    let pass=b.pass;if(b.id&&(pass===undefined||pass==='')){const o=db.get(b.id);if(o)pass=o.pass}
    const cand=b.autoport?[...new Set([f.v.port,80,8080,2020,8899,8000,5000])]:[f.v.port];
    const up=await Promise.all(cand.map(p=>tcpOpen(f.v.host,p)));const ports=cand.filter((p,i)=>up[i]);let err;
    if(!ports.length)return bad(r,502,'Aucune réponse de '+f.v.host+(b.autoport?'':' sur le port '+f.v.port)+'. Vérifiez que la caméra est allumée, sur le même réseau que ce PC, et que l\'adresse IP est correcte.');
    for(const port of ports){
      try{const s=await open({...f.v,pass:pass||'',port});
        return ok(r,{port,info:s.info,ptz:s.canPtz,profiles:s.profiles.length,resolution:s.main.w+'×'+s.main.h,rtsp:withAuth(s.rtspMain,f.v.user,pass)})}
      catch(e){err=e;if(e.auth)break}}
    throw err}));
  app.get(A+'/:id/info',wrap(async(q,r)=>{const c=cam(q,r);if(!c)return;const s=await sess(c);
    ok(r,{info:s.info,ptz:s.canPtz,resolution:s.main.w+'×'+s.main.h,rtspMain:withAuth(c.rtsp||s.rtspMain,c.user,c.pass),rtspSub:withAuth(s.rtspSub,c.user,c.pass)})}));
  app.get(A+'/:id/stream.mjpg',async(q,r)=>{
    const c=db.get(q.params.id);if(!c)return bad(r,404,'Caméra inconnue.');
    let url=c.rtsp;
    try{if(!url){const s=await sess(c);url=s.rtspSub||s.rtspMain}}catch(e){return bad(r,e.auth?401:502,e.message)}
    if(!url)return bad(r,502,'Adresse du flux vidéo introuvable : saisissez l\'adresse RTSP dans les réglages de la caméra.');
    url=withAuth(url,c.user,c.pass);
    r.writeHead(200,{'Content-Type':'multipart/x-mixed-replace;boundary=frame','Cache-Control':'no-store','Connection':'close'});
    streams.add(c.id,url,r);
    /* Sans image au bout de 12 s : on coupe pour que l'interface affiche une erreur */
    const t=setTimeout(()=>{const s=streams.m.get(c.id);if(s&&!s.got){const e=s.err;streams.kill(c.id);if(!r.writableEnded)r.end()}},12000);r.on('close',()=>clearTimeout(t));
  });
  app.get(A+'/:id/stream-error',(q,r)=>{const s=streams.m.get(q.params.id);r.json({error:s?s.err:''})});

  /* PTZ. Arrêt automatique si l'ordre « stop » se perd (fenêtre fermée, bouton relâché hors de l'écran…) */
  const stopLater=(c,s)=>{clearTimeout(stops.get(c.id));stops.set(c.id,setTimeout(()=>{stops.delete(c.id);PTZ.stop(s).catch(()=>{})},1500))};
  app.post(A+'/:id/ptz',J,wrap(async(q,r)=>{const c=cam(q,r);if(!c)return;const b=q.body||{},s=await sess(c);
    switch(b.action){
      case'move':await PTZ.move(s,b.x,b.y,b.z);stopLater(c,s);return ok(r);
      case'stop':clearTimeout(stops.get(c.id));stops.delete(c.id);await PTZ.stop(s);return ok(r);
      case'home':await PTZ.home(s);return ok(r);
      case'goto':await PTZ.goto(s,String(b.token));return ok(r);
      case'presets':return ok(r,{presets:await PTZ.presets(s)});
      case'save':{const t=await PTZ.save(s,String(b.name||'').slice(0,40),b.token&&String(b.token));return ok(r,{token:t,presets:await PTZ.presets(s)})}
      case'remove':await PTZ.remove(s,String(b.token));return ok(r,{presets:await PTZ.presets(s)});
    }bad(r,400,'Action inconnue.')}));
  return{close(){streams.killAll();for(const t of stops.values())clearTimeout(t)}};
}
module.exports={mount,open,PTZ,isLan};
