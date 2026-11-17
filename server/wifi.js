/* Recherche des réseaux Wi-Fi visibles, pour les CHOISIR dans une liste au lieu de taper leur nom (risque de faute).
   Deux sources :
   - le PC (Windows : « netsh wlan show networks », Linux : « nmcli ») s'il a une carte Wi-Fi ;
   - sinon, un téléphone en direct (Android : WifiManager, avec l'autorisation de localisation déjà demandée par l'application).
   Aucune lecture automatique : la personne choisit elle-même le réseau dans la liste. */
const {execFile}=require('child_process');

/* Nom de réseau : sans caractères de contrôle, 32 caractères au plus (limite du Wi-Fi) */
const cleanSsid=s=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,32);
const bandOfMHz=f=>typeof f==='number'&&f>0?(f<3000?'2,4':f<5925?'5':'6'):null;
const bandOfChannel=c=>c>0?(c<=14?'2,4':'5'):null;
const bandOfText=t=>{const m=/(\d+(?:[.,]\d+)?)\s*GHz/i.exec(t||'');if(!m)return null;const g=parseFloat(m[1].replace(',','.'));return g<3?'2,4':g<5.9?'5':'6'};

/* Sortie de « netsh wlan show networks mode=bssid » (français ou anglais : on ne s'appuie que sur la forme des lignes) */
function parseNetsh(text){
  const out=[];let cur=null,bss=null;
  const flush=()=>{if(cur&&bss)cur.bss.push(bss);bss=null};
  for(const raw of String(text||'').split(/\r?\n/)){
    const l=raw.trim();let m;
    if((m=/^SSID\s+\d+\s*:\s*(.*)$/.exec(l))){flush();cur={ssid:cleanSsid(m[1]),bss:[]};out.push(cur);continue}
    if(!cur)continue;
    if(/^BSSID\s+\d+\s*:/.test(l)){flush();bss={band:null,signal:null,chan:null};continue}
    if(!bss)continue;
    if((m=/^(?:Signal)\s*:\s*(\d+)\s*%/i.exec(l)))bss.signal=+m[1];
    else if((m=/^(?:Band|Bande)\s*:\s*(.+)$/i.exec(l)))bss.band=bandOfText(m[1]);
    else if((m=/^(?:Channel|Canal|Kanal|Canale)\s*:\s*(\d+)/i.exec(l)))bss.chan=+m[1];
  }
  flush();
  const res=[];
  for(const n of out){
    if(!n.ssid)continue;   /* réseau masqué : pas de nom à proposer */
    for(const b of n.bss)res.push({ssid:n.ssid,band:b.band||bandOfChannel(b.chan),signal:b.signal});
  }
  return res;
}

/* Sortie de « nmcli -t -f SSID,FREQ,SIGNAL dev wifi list » : « Nom:5180 MHz:78 » (les « : » du nom sont précédés d'une barre oblique) */
function parseNmcli(text){
  const res=[];
  for(const l of String(text||'').split(/\r?\n/)){
    if(!l.trim())continue;
    const parts=[];let s='';
    for(let i=0;i<l.length;i++){if(l[i]==='\\'&&l[i+1]){s+=l[++i]}else if(l[i]===':'){parts.push(s);s=''}else s+=l[i]}
    parts.push(s);
    if(parts.length<3)continue;
    const ssid=cleanSsid(parts[0]),mhz=parseInt(parts[1],10),sig=parseInt(parts[2],10);
    if(ssid)res.push({ssid,band:bandOfMHz(mhz),signal:isFinite(sig)?sig:null});
  }
  return res;
}

/* Liste envoyée par un téléphone : [{ssid, freq}] (valeurs vérifiées, le téléphone est un appareil du réseau) */
function fromPhone(list){
  const res=[];
  if(!Array.isArray(list))return res;
  for(const x of list.slice(0,100)){
    if(!x||typeof x!=='object')continue;
    const ssid=cleanSsid(typeof x.ssid==='string'?x.ssid:'');
    if(!ssid)continue;
    const lv=typeof x.level==='number'&&isFinite(x.level)?x.level:null;   /* dBm -> pourcentage approximatif */
    res.push({ssid,band:bandOfMHz(typeof x.freq==='number'&&isFinite(x.freq)?x.freq:0),signal:lv==null?null:Math.max(0,Math.min(100,Math.round(2*(lv+100))))});
  }
  return res;
}

/* Regroupe par nom : un même réseau peut être sur 2,4 et 5 GHz (plusieurs bornes). Les réseaux qui offrent le 5 GHz passent en premier. */
function mergeNetworks(list){
  const map=new Map();
  for(const x of list||[]){
    if(!x||!x.ssid)continue;
    const n=map.get(x.ssid)||{ssid:x.ssid,bands:[],signal:null};
    if(x.band&&!n.bands.includes(x.band))n.bands.push(x.band);
    if(typeof x.signal==='number'&&(n.signal==null||x.signal>n.signal))n.signal=x.signal;
    map.set(x.ssid,n);
  }
  const order=['2,4','5','6'];
  const all=[...map.values()].map(n=>({...n,bands:n.bands.sort((a,b)=>order.indexOf(a)-order.indexOf(b)),g5:n.bands.includes('5')||n.bands.includes('6')}));
  return all.sort((a,b)=>(b.g5-a.g5)||((b.signal??-1)-(a.signal??-1))||a.ssid.localeCompare(b.ssid));
}

const run=(cmd,args,ms)=>new Promise(res=>execFile(cmd,args,{windowsHide:true,timeout:ms||15000,maxBuffer:2e6,encoding:'utf8'},(err,so)=>res(err?'':String(so||''))));

/* Recherche faite par le PC lui-même. Renvoie [] sans carte Wi-Fi (PC en câble) ou sur un système non géré. */
async function scanPC(platform){
  platform=platform||process.platform;
  if(platform==='win32'){
    /* chcp 65001 : les noms avec accents arrivent en UTF-8 */
    const t=await run('cmd.exe',['/d','/s','/c','chcp 65001>nul && netsh wlan show networks mode=bssid']);
    return mergeNetworks(parseNetsh(t));
  }
  if(platform==='linux'){
    const t=await run('nmcli',['-t','-f','SSID,FREQ,SIGNAL','dev','wifi','list','--rescan','auto']);
    return mergeNetworks(parseNmcli(t));
  }
  return [];
}

module.exports={cleanSsid,parseNetsh,parseNmcli,fromPhone,mergeNetworks,scanPC};
