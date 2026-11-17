/* Recherche des réseaux Wi-Fi à choisir dans une liste : lecture de « netsh » (français et anglais) et de « nmcli », liste envoyée par un téléphone,
   et l'API de la fenêtre du PC (réseaux du PC, sinon réseaux vus par le téléphone, sinon explication). */
const assert=require('assert'),WebSocket=require('ws'),http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
const {parseNetsh,parseNmcli,fromPhone,mergeNetworks,cleanSsid}=require('../wifi');
const {createServer}=require('../server');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

/* 1) netsh en anglais et en français : deux bornes pour « Eglise-5G » (2,4 et 5 GHz), un réseau masqué ignoré, accents conservés */
const en=`Interface name : Wi-Fi
There are 4 networks currently visible.

SSID 1 : Eglise-5G
    Network type            : Infrastructure
    Authentication          : WPA2-Personal
    Encryption              : CCMP
    BSSID 1                 : aa:bb:cc:dd:ee:01
         Signal             : 82%
         Radio type         : 802.11ac
         Band               : 5 GHz
         Channel            : 36
    BSSID 2                 : aa:bb:cc:dd:ee:02
         Signal             : 55%
         Radio type         : 802.11n
         Band               : 2.4 GHz
         Channel            : 6

SSID 2 : Voisin
    Network type            : Infrastructure
    BSSID 1                 : 11:22:33:44:55:66
         Signal             : 90%
         Radio type         : 802.11n
         Channel            : 1

SSID 3 :
    Network type            : Infrastructure
    BSSID 1                 : 77:88:99:aa:bb:cc
         Signal             : 70%
         Channel            : 44
`;
let n=mergeNetworks(parseNetsh(en));
assert.deepStrictEqual(n.map(x=>x.ssid),['Eglise-5G','Voisin'],'le réseau avec 5 GHz passe en premier, le réseau masqué est ignoré');
assert.deepStrictEqual(n[0].bands,['2,4','5'],'les deux bandes du même nom sont regroupées');assert(n[0].g5===true&&n[0].signal===82,'meilleur signal gardé');
assert.deepStrictEqual(n[1].bands,['2,4'],'sans ligne « Band » : bande déduite du canal (1 = 2,4 GHz)');assert(n[1].g5===false);
const fr=`Nom de l’interface : Wi-Fi
SSID 1 : Église Tabernacle 5G
    Type de réseau          : Infrastructure
    Authentification        : WPA2 - Personnel
    BSSID 1                 : aa:bb:cc:dd:ee:01
         Signal             : 64%
         Type de radio      : 802.11ac
         Bande              : 5 GHz
         Canal              : 100
SSID 2 : Box-1234
    BSSID 1                 : 12:34:56:78:9a:bc
         Signal             : 40%
         Canal              : 40
`;
n=mergeNetworks(parseNetsh(fr));
assert.deepStrictEqual(n.map(x=>x.ssid),['Église Tabernacle 5G','Box-1234'],'sortie française : accents conservés');
assert.deepStrictEqual(n[1].bands,['5'],'sans « Bande » : canal 40 = 5 GHz');
assert.deepStrictEqual(parseNetsh('Le service de configuration automatique de réseau local sans fil (wlansvc) n\'est pas en cours d\'exécution.'),[],'PC sans Wi-Fi : liste vide');
assert.deepStrictEqual(parseNetsh(''),[]);

/* 2) nmcli : noms avec « : » échappé */
n=mergeNetworks(parseNmcli('Eglise-5G:5180 MHz:78\nEglise-5G:2437 MHz:60\nCafe\\:Wifi:2412 MHz:30\n:5200 MHz:50\n'));
assert.deepStrictEqual(n.map(x=>x.ssid),['Eglise-5G','Cafe:Wifi'],'nmcli : nom avec deux-points, réseau masqué ignoré');assert.deepStrictEqual(n[0].bands,['2,4','5']);

/* 3) liste d'un téléphone : fréquence -> bande, niveau dBm -> pourcentage, valeurs invalides ignorées */
n=mergeNetworks(fromPhone([{ssid:'Eglise-5G',freq:5200,level:-50},{ssid:'Eglise-2G',freq:2412,level:-70},{ssid:'',freq:5200},{ssid:42},null,{ssid:'x'.repeat(80),freq:2412,level:-60}]));
assert.deepStrictEqual(n.map(x=>x.ssid)[0],'Eglise-5G');assert.strictEqual(n[0].signal,100);assert.strictEqual(n.length,3,'invalides ignorés');
assert(n.every(x=>x.ssid.length<=32),'noms limités à 32 caractères');
assert.deepStrictEqual(fromPhone('pas une liste'),[]);assert(fromPhone(Array(500).fill({ssid:'a',freq:2412})).length<=100,'liste bornée');
assert.strictEqual(cleanSsid('a\u0000b\nc'),'abc','caractères de contrôle retirés');

/* 4) API de la fenêtre du PC */
const req=(port,p,headers={})=>new Promise(res=>{http.get({host:'127.0.0.1',port,path:p,headers},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{let j=null;try{j=JSON.parse(b)}catch{}res({status:r.statusCode,json:j})})}).on('error',()=>res({status:0}))});
const phone=(port,room,reply)=>new Promise(r=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws');w.q=[];
  w.on('message',d=>{const m=JSON.parse(d);w.q.push(m);if(m.type==='wifiscan'&&reply)reply(w)});
  w.on('open',()=>{w.send(JSON.stringify({type:'join',role:'publisher',room,id:'t-'+room}));r(w)})});
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wifiscan-'));
  let pcList=[{ssid:'Eglise-5G',bands:['2,4','5'],signal:80,g5:true}];
  const srv=createServer({grace:300,cameras:false,dataDir:dir,wifiScan:async()=>pcList,wifiPhoneMs:1500});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;

  let r=await req(port,'/api/wifi/scan');
  assert(r.status===200&&r.json.ok&&r.json.source==='pc'&&r.json.networks[0].ssid==='Eglise-5G','le PC voit des réseaux : liste du PC');
  r=await req(port,'/api/wifi/scan',{Origin:'http://evil.example'});assert(r.status===403,'une page d\'un autre site est refusée');
  r=await req(port,'/api/wifi/scan',{'Sec-Fetch-Site':'cross-site'});assert(r.status===403,'requête « inter-sites » refusée');

  /* PC en câble (aucun réseau) et aucun téléphone : explication claire */
  pcList=[];r=await req(port,'/api/wifi/scan');
  assert(r.json.ok&&r.json.source===null&&r.json.networks.length===0&&/câble|carte Wi-Fi/.test(r.json.note)&&/téléphone/.test(r.json.note),'sans PC Wi-Fi ni téléphone : message qui explique quoi faire ('+r.json.note+')');

  /* PC en câble, un téléphone en direct qui répond */
  const p=await phone(port,'camA',w=>w.send(JSON.stringify({type:'wifilist',list:[{ssid:'Eglise-5G',freq:5240,level:-48},{ssid:'Eglise-2G',freq:2412,level:-40}]})));
  const t0=Date.now();r=await req(port,'/api/wifi/scan');
  assert(r.json.source==='phone'&&r.json.networks.length===2&&r.json.networks[0].ssid==='Eglise-5G'&&Date.now()-t0<1200,'réseaux trouvés par le téléphone, sans attendre le délai complet');
  assert(p.q.some(m=>m.type==='wifiscan'),'le téléphone a reçu la demande de recherche');
  p.close();await wait(100);

  /* téléphone trop ancien (ne sait pas chercher) */
  const old=await phone(port,'camB',w=>w.send(JSON.stringify({type:'wifilist',list:[],unsupported:true})));
  r=await req(port,'/api/wifi/scan');assert(r.json.networks.length===0&&/mis à jour/.test(r.json.note),'ancien APK : on dit de le mettre à jour ('+r.json.note+')');old.close();await wait(100);

  /* téléphone sans autorisation de localisation : liste vide, explication */
  const noloc=await phone(port,'camC',w=>w.send(JSON.stringify({type:'wifilist',list:[]})));
  r=await req(port,'/api/wifi/scan');assert(r.json.networks.length===0&&/localisation/.test(r.json.note),'liste vide : on explique la localisation ('+r.json.note+')');noloc.close();await wait(100);

  /* téléphone qui ne répond pas : fin au bout du délai, sans blocage */
  const mute=await phone(port,'camD',null);const t1=Date.now();r=await req(port,'/api/wifi/scan');
  assert(r.json.ok&&r.json.networks.length===0&&Date.now()-t1>=1400&&Date.now()-t1<4000,'téléphone muet : la recherche se termine d\'elle-même');mute.close();await wait(100);

  /* un appareil qui n'a pas demandé de recherche ne peut pas injecter de réseaux */
  const spy=await phone(port,'camE',null);spy.send(JSON.stringify({type:'wifilist',list:[{ssid:'Intrus',freq:5200,level:-30}]}));await wait(100);
  pcList=[{ssid:'Eglise-5G',bands:['5'],signal:80,g5:true}];r=await req(port,'/api/wifi/scan');assert(!r.json.networks.some(x=>x.ssid==='Intrus'),'liste non sollicitée ignorée');spy.close();
  srv.close();console.log('OK recherche des réseaux Wi-Fi (netsh fr/en, nmcli, téléphone, API, protection)');process.exit(0);
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
