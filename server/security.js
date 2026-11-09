/* Protections contre les pages web malveillantes ouvertes sur le PC (CSRF / détournement WebSocket / DNS rebinding).
   Le PC lui-même (127.0.0.1) est exempté du code d'appairage : il faut donc s'assurer que la demande vient bien
   d'une page TPR Live et pas d'un site quelconque ouvert dans un navigateur du PC. */
const isLocalAddr=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';
const hostName=h=>{h=String(h||'');const m=/^\[([^\]]+)\](?::\d+)?$/.exec(h);return(m?m[1]:h.replace(/:\d+$/,'')).toLowerCase()};
/* Anti « DNS rebinding » : une demande locale doit viser localhost ou une adresse IP, jamais un nom de domaine. */
const hostOk=h=>{const n=hostName(h);return n==='localhost'||/^\d{1,3}(\.\d{1,3}){3}$/.test(n)||n.includes(':')};
/* Origine : absente (client non navigateur) = acceptée ; sinon même hôte que la page, ou l'origine de l'application
   Android (http://localhost, sans port) pour les appareils distants uniquement. */
const originOk=(origin,host,local)=>{
  if(!origin)return true;
  if(origin==='null')return false;
  try{const u=new URL(origin);
    if(u.host===host)return true;
    return !local&&u.origin==='http://localhost';
  }catch{return false}
};
/* Demande locale légitime : adresse 127.0.0.1, hôte localhost/IP, origine cohérente. */
const localRequestOk=q=>{
  if(!isLocalAddr(q.socket.remoteAddress)||!hostOk(q.headers.host)||!originOk(q.headers.origin,q.headers.host,true))return false;
  const f=q.headers['sec-fetch-site'];            /* envoyé par les navigateurs : « cross-site » = page d'un autre site */
  return !f||f==='same-origin'||f==='none';
};
module.exports={isLocalAddr,hostName,hostOk,originOk,localRequestOk};
