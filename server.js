'use strict';
/* Сириус — сервер. Без зависимостей: только Node.js 18+.  Запуск: node server.js */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||3000,DIR=process.env.DATA_DIR||path.join(__dirname,'data'),MEDIA=path.join(DIR,'media'),FILE=path.join(DIR,'db.json');
fs.mkdirSync(MEDIA,{recursive:true});
const COLS=['users','friends','blocks','posts','groups','stories','calls','msgs','gifts'];
const DB={tokens:{},rec:{},bal:{},orders:{},admins:{},gcount:{},audit:[],ordn:0,secret:'',push:{},vapid:null};COLS.forEach(c=>DB[c]={});
try{const d=JSON.parse(fs.readFileSync(FILE,'utf8'));Object.keys(DB).forEach(k=>{if(d[k])DB[k]=d[k]})}catch(e){}
for(const[id,c]of Object.entries(DB.calls))if(Date.now()-(c.t||0)>36e5)delete DB.calls[id];/* первичная чистка при старте, до того как save/broadcast объявлены ниже */
let timer=0;const save=()=>{if(timer)return;timer=setTimeout(()=>{timer=0;fs.writeFile(FILE+'.tmp',JSON.stringify(DB),e=>{if(!e)fs.rename(FILE+'.tmp',FILE,()=>{})})},500)};
const hash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
if(!DB.secret)DB.secret=crypto.randomBytes(32).toString('hex');
DB.tokens.bot=hash(crypto.randomBytes(16));/* id 'bot' зарезервирован: занять его нельзя */
DB.users.bot={name:'Сириус Бот',un:'sirius_bot',bio:'Служебный бот: зачисления ★ и уведомления',av:'',hidden:true,seen:0};
save();
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sd=(a,b)=>{a=a||[];b=b||[];return[...a.filter(x=>!b.includes(x)),...b.filter(x=>!a.includes(x))]};
const isAdm=(g,u)=>!!g&&(g.by===u||(g.adm||[]).includes(u)),isMem=(g,u)=>!!g&&(g.mem||[]).includes(u);
const deny=m=>Object.assign(new Error(m||'Запрещено'),{code:403});
const PUB=['name','un','bio','av','cv','st','bd','hbd','seen','invisible','hidden','fonly','nopost','fph','nocall','pk'];
const viewUser=(v,u,id)=>{if(id===u)return v;const o={};PUB.forEach(k=>{if(v[k]!==undefined)o[k]=v[k]});if(v.fph&&v.ph)o.ph=v.ph;return o};
function canSee(c,v,u){
  if(c==='msgs'){const g=DB.groups[v.c];if(g)return isMem(g,u)||!!(g.ch&&g.pub);return String(v.c).split('_').includes(u)}
  if(c==='blocks')return v.by===u||v.to===u;
  if(c==='calls')return v.from===u||v.to===u;
  return true}
function state(u){const s={};for(const c of COLS){s[c]={};for(const[id,v]of Object.entries(DB[c])){if(canSee(c,v,u))s[c][id]=c==='users'?viewUser(v,u,id):v}}return s}
setInterval(()=>{let ch=0;for(const[id,c]of Object.entries(DB.calls))if(Date.now()-(c.t||0)>36e5){delete DB.calls[id];ch=1}if(ch){save();clients.forEach(cl=>send(cl,{t:'init',s:state(cl.u)}))}},3e5).unref();
const clients=new Set();
const send=(cl,o)=>{try{cl.res.write('data: '+JSON.stringify(o)+'\n\n')}catch(e){}};
function broadcast(c,id,v){
  if(c==='groups'){clients.forEach(cl=>send(cl,{t:'init',s:state(cl.u)}));return}
  clients.forEach(cl=>{if(v===undefined)send(cl,{t:'del',c,id});else if(canSee(c,v,cl.u))send(cl,{t:'set',c,id,v:c==='users'?viewUser(v,cl.u,id):v});else send(cl,{t:'del',c,id})})}
function canDel(c,id,old,u){
  switch(c){
    case'users':return id===u;
    case'friends':return id.split('_').includes(u);
    case'blocks':return old.by===u;
    case'posts':case'stories':return old.by===u;
    case'groups':return old.by===u;
    case'calls':return old.from===u||old.to===u;
    case'msgs':{const g=DB.groups[old.c];return old.from===u||(g?isAdm(g,u):String(old.c).split('_').includes(u))}}
  return false}
function canWrite(c,id,old,nv,u){
  switch(c){
    case'users':{if(id!==u)return false;if(nv.un!==undefined){const un=String(nv.un);if(!/^[a-z0-9_]{3,20}$/.test(un))return false;if(Object.entries(DB.users).some(([i,x])=>i!==id&&x.un===un))return false}return true}
    case'friends':{const[f,t]=id.split('_');if(!f||!t||f===t||nv.from!==f||nv.to!==t)return false;if(!old)return u===f&&nv.st==='p';return(u===t&&nv.st==='ok')||(u===f&&nv.st==='p'&&old.st==='p')}
    case'blocks':{const[b,t]=id.split('_');return u===b&&nv.by===b&&nv.to===t}
    case'posts':{if(!old)return nv.by===u;if(old.by===u)return nv.by===old.by;
      return sd(old.lk,nv.lk).every(x=>x===u)&&eq((old.cm||[]).filter(x=>x.by!==u),(nv.cm||[]).filter(x=>x.by!==u))&&(nv.cm||[]).filter(x=>x.by===u).length<=200&&Object.keys({...old,...nv}).every(k=>k==='lk'||k==='cm'||eq(old[k],nv[k]))}
    case'groups':{
      if(nv.un&&Object.entries(DB.groups).some(([i,x])=>i!==id&&x.un===nv.un))return false;
      if(!old)return nv.by===u&&Array.isArray(nv.mem)&&nv.mem.includes(u);
      if(nv.by!==old.by)return false;
      if(isAdm(old,u))return Array.isArray(nv.mem);
      const ch=sd(old.mem,nv.mem);if(!ch.every(x=>x===u))return false;
      if((nv.mem||[]).includes(u)&&!(old.mem||[]).includes(u)&&!old.ch)return false;
      const oa=old.adm||[old.by],na=nv.adm||oa;if(!sd(oa,na).every(x=>x===u)||(na.includes(u)&&!oa.includes(u)))return false;
      return Object.keys({...old,...nv}).every(k=>k==='mem'||k==='adm'||eq(old[k],nv[k]))}
    case'msgs':{const g=DB.groups[old?old.c:nv.c];
      if(nv.kind==='gift'||(old&&old.kind==='gift')){if(!old||old.kind!=='gift'||nv.kind!=='gift'||nv.body!==old.body||nv.gn!==old.gn||!eq(nv.gd,old.gd))return false}
      if(!old){if(nv.from!==u||typeof nv.c!=='string')return false;if(g)return isMem(g,u)&&(!g.ch||isAdm(g,u));const ps=nv.c.split('_');return ps.includes(u)&&!ps.includes('bot')&&nv.e===1}
      if(nv.c!==old.c||nv.from!==old.from)return false;
      if(old.from===u)return g?true:(nv.e===1||nv.body===old.body);
      if(!canSee('msgs',old,u))return false;
      const rxk=new Set([...Object.keys(old.rx||{}),...Object.keys(nv.rx||{})]);
      for(const k of rxk)if(!sd((old.rx||{})[k],(nv.rx||{})[k]).every(x=>x===u))return false;
      return Object.keys({...old,...nv}).every(k=>k==='rx'||k==='rd'||eq(old[k],nv[k]))}
    case'stories':{if(!old)return nv.by===u;if(old.by===u)return nv.by===u;
      const ks=new Set([...Object.keys(old.rx||{}),...Object.keys(nv.rx||{})]);for(const k of ks)if(k!==u&&!eq((old.rx||{})[k],(nv.rx||{})[k]))return false;
      return Object.keys({...old,...nv}).every(k=>k==='rx'||eq(old[k],nv[k]))}
    case'calls':{if(!old)return nv.from===u&&!!nv.to;return(old.from===u||old.to===u)&&nv.from===old.from&&nv.to===old.to}
  }
  return false}
function apply(u,op,c,id,v){
  const old=DB[c][id];
  if(op==='delete'){if(!old)return;if(!canDel(c,id,old,u))throw deny();if(c==='users')delete DB.rec[u];delete DB[c][id];save();broadcast(c,id,undefined);return}
  v=v&&typeof v==='object'&&!Array.isArray(v)?v:{};
  const nv=op==='update'?Object.assign({},old||{},v):v;
  if(!canWrite(c,id,old,nv,u))throw deny();
  DB[c][id]=nv;save();broadcast(c,id,nv)}
function auth(u,t){if(!/^[A-Za-z0-9_\-]{3,40}$/.test(u||'')||!t||String(t).length<8)return false;const h=hash(t);if(!DB.tokens[u]){DB.tokens[u]=h;save();return true}return DB.tokens[u]===h}

/* ================= Восстановление профиля, магазин ★, подарки ================= */
const err=(m,c)=>Object.assign(new Error(m),{code:c||400});
const ipOf=req=>String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
const ceq=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const sh=(p,salt)=>crypto.scryptSync(String(p),String(salt),32).toString('hex');
const nq=q=>String(q||'').trim().toLowerCase().replace(/^@/,'');
const FL={};/* неудачные попытки: защита от подбора паролей и кодов */
const locked=(k,max,ms)=>{const n=Date.now(),a=(FL[k]||[]).filter(t=>n-t<ms);FL[k]=a;return a.length>=max};
const fail=k=>{(FL[k]=FL[k]||[]).push(Date.now())};
setInterval(()=>{const n=Date.now();for(const k of Object.keys(FL)){FL[k]=FL[k].filter(t=>n-t<9e5);if(!FL[k].length)delete FL[k]}},6e5).unref();
const pushBal=u=>{const v=DB.bal[u]||0;clients.forEach(cl=>{if(cl.u===u)send(cl,{t:'bal',v})})};

/* ===================== Push-уведомления (Web Push / VAPID, без сторонних зависимостей) =====================
   Будит приложение, даже когда вкладка/страница закрыта, через Service Worker. Шлём пуши БЕЗ зашифрованного
   тела (payload-less push, это штатный режим протокола) — сервис-воркер на получении просто показывает
   уведомление; это заметно надёжнее самодельного шифрования пуша и не требует внешних библиотек.
   Касается именно открытия «Сириус» как PWA/в Chrome или TWA-сборки APK на Chrome — см. комментарий у LUSER()
   в index.html про обычный android.webkit.WebView. */
if(!DB.vapid){const kp=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=kp.publicKey.export({format:'jwk'}),priv=kp.privateKey.export({format:'jwk'});DB.vapid={x:pub.x,y:pub.y,d:priv.d};save()}
const b64u=b=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const ub64u=s=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64');
const VAPID_PUB=b64u(Buffer.concat([Buffer.from([4]),ub64u(DB.vapid.x),ub64u(DB.vapid.y)]));
const VAPID_KEY=crypto.createPrivateKey({key:{kty:'EC',crv:'P-256',x:DB.vapid.x,y:DB.vapid.y,d:DB.vapid.d},format:'jwk'});
const VAPID_SUB=process.env.VAPID_SUBJECT||'mailto:admin@example.com';
const vapidAuth=origin=>{const h=b64u(JSON.stringify({typ:'JWT',alg:'ES256'})),p=b64u(JSON.stringify({aud:origin,exp:Math.floor(Date.now()/1e3)+12*3600,sub:VAPID_SUB})),d=h+'.'+p,sig=crypto.sign('sha256',Buffer.from(d),{key:VAPID_KEY,dsaEncoding:'ieee-p1363'});return'vapid t='+d+'.'+b64u(sig)+', k='+VAPID_PUB};
function sendPush(u){
  const subs=DB.push[u];if(!subs)return;
  for(const id of Object.keys(subs)){
    const s=subs[id];
    try{
      const url=new URL(s.endpoint),mod=url.protocol==='https:'?require('https'):require('http');
      const req=mod.request({hostname:url.hostname,path:url.pathname+url.search,port:url.port||(url.protocol==='https:'?443:80),method:'POST',
        headers:{'TTL':'86400','Content-Length':0,'Authorization':vapidAuth(url.origin)}},res=>{
          if(res.statusCode===404||res.statusCode===410){delete DB.push[u][id];save()}/* подписка отозвана/истекла — чистим */
          res.resume()});
      req.on('error',()=>{});req.end()
    }catch(e){}
  }
}
const credit=(u,n,why)=>{DB.bal[u]=(DB.bal[u]||0)+n;DB.audit.push({t:Date.now(),u,n,why});if(DB.audit.length>1000)DB.audit.splice(0,DB.audit.length-1000);save();pushBal(u)};
const botMsg=(u,tx)=>{const id='mb'+Date.now()+Math.random().toString(36).slice(2,6),v={c:['bot',u].sort().join('_'),from:'bot',t:Date.now(),kind:'text',body:tx,rx:{},rd:0};DB.msgs[id]=v;save();broadcast('msgs',id,v)};
const adm=u=>{if(!DB.admins[u])throw err('Нет прав владельца',403)};
const userByUn=un=>Object.entries(DB.users).find(([i,x])=>i!=='bot'&&x.un===nq(un));

/* Настройки владельца — только через переменные окружения (см. README) */
const OWNER={card:(process.env.OWNER_CARD||'').replace(/\D/g,''),holder:process.env.OWNER_NAME||'',bank:process.env.OWNER_BANK||'',url:process.env.PAY_URL||''};
const RATE=+process.env.STAR_RUB||1,MINS=+process.env.MIN_STARS||10,MAXS=+process.env.MAX_STARS||100000,DEV=process.env.DEV_CODE||'';
/* Каталог подарков. r: 0 обычный · 1 редкий · 2 эпический · 3 легендарный · 4 мифический.
   p — цена в ★, s — тираж (сколько экземпляров вообще может существовать; без s — безлимит).
   Чем реже подарок — тем меньше тираж и выше цена. Правьте список под себя. */
const GIFTS=[
 {id:'rose',e:'🌹',n:'Роза',r:0,p:10},
 {id:'choc',e:'🍫',n:'Шоколад',r:0,p:15},
 {id:'cake',e:'🍰',n:'Тортик',r:0,p:25},
 {id:'bear',e:'🧸',n:'Плюшевый мишка',r:1,p:75,s:10000},
 {id:'bouq',e:'💐',n:'Букет',r:1,p:100,s:10000},
 {id:'ball',e:'🎈',n:'Воздушный шар',r:1,p:60,s:10000},
 {id:'bfly',e:'🦋',n:'Хрустальная бабочка',r:2,p:250,s:1000},
 {id:'ring',e:'💍',n:'Кольцо',r:2,p:300,s:1000},
 {id:'cup',e:'🏆',n:'Кубок чемпиона',r:2,p:400,s:1000},
 {id:'drag',e:'🐉',n:'Дракон',r:3,p:1000,s:100},
 {id:'gem',e:'💎',n:'Бриллиант',r:3,p:1200,s:100},
 {id:'crown',e:'👑',n:'Корона',r:3,p:1500,s:100},
 {id:'planet',e:'🪐',n:'Личная планета',r:4,p:5000,s:10},
 {id:'sirius',e:'🌟',n:'Звезда «Сириус»',r:4,p:10000,s:5}
];
const gLeft=g=>g.s?Math.max(0,g.s-(DB.gcount[g.id]||0)):null;
const isFr=(a,b)=>(DB.friends[a+'_'+b]||DB.friends[b+'_'+a]||{}).st==='ok';
const isBl=(a,b)=>!!(DB.blocks[a+'_'+b]||DB.blocks[b+'_'+a]);
const API={
 /* --- восстановление профиля по облачному паролю (сервер пароль не видит: только производное значение) --- */
 'rec/start':{open:1,f:(u,b,req)=>{const k='rs:'+ipOf(req);if(locked(k,60,9e5))throw err('Слишком много запросов',429);fail(k);
   const un=nq(b.un),f=Object.entries(DB.users).find(([i,x])=>x.un===un&&DB.rec[i]),fk=crypto.createHmac('sha256',DB.secret).update('fake:'+un).digest();
   return f?{uid:f[0],salt:DB.rec[f[0]].salt}:{uid:'x'+fk.toString('hex').slice(0,12),salt:fk.subarray(0,16).toString('base64')}}},
 'rec/do':{open:1,f:(u,b,req)=>{const uid=String(b.uid||''),tok=String(b.tok||''),pr=String(b.proof||''),k1='r:'+uid,k2='ri:'+ipOf(req);
   if(locked(k1,5,9e5)||locked(k2,20,9e5))throw err('Слишком много попыток. Подождите 15 минут.',429);
   const r=DB.rec[uid];if(!r||!/^[0-9a-f]{64}$/.test(pr)||!/^[A-Za-z0-9]{16,64}$/.test(tok)||!ceq(sh(pr,r.ss),r.h)){fail(k1);fail(k2);throw err('Неверный username или облачный пароль',403)}
   DB.tokens[uid]=hash(tok);save();return{vault:r.vault,salt:r.salt}}},/* новый токен: старые сессии теряют доступ */
 'rec/vault':{f:u=>{const r=DB.rec[u];if(!r)throw err('Резервная копия не найдена',404);return{salt:r.salt,vault:r.vault}}},
 /* --- push-уведомления --- */
 'push/vapidkey':{open:1,f:()=>({key:VAPID_PUB})},
 'push/sub':{f:(u,b)=>{if(!b||typeof b.endpoint!=='string'||!/^https:\/\//.test(b.endpoint))throw err('Неверная подписка');
   const id=hash(b.endpoint).slice(0,24);(DB.push[u]=DB.push[u]||{})[id]={endpoint:b.endpoint,t:Date.now()};save();return{ok:1}}},
 'push/unsub':{f:(u,b)=>{if(DB.push[u])delete DB.push[u][hash(String(b.endpoint||'')).slice(0,24)];save();return{ok:1}}},
 'rec/set':{f:(u,b)=>{const salt=String(b.salt||''),pr=String(b.proof||''),vault=String(b.vault||'');
   if(!/^[A-Za-z0-9+/=]{16,64}$/.test(salt)||!/^[0-9a-f]{64}$/.test(pr)||!/^[A-Za-z0-9+/=]{20,8192}$/.test(vault))throw err('Неверные данные');
   const o=DB.rec[u];if(o){const k='rc:'+u;if(locked(k,5,9e5))throw err('Слишком много попыток',429);if(!/^[0-9a-f]{64}$/.test(String(b.old||''))||!ceq(sh(b.old,o.ss),o.h)){fail(k);throw err('Неверный текущий облачный пароль',403)}}
   const ss=crypto.randomBytes(16).toString('hex');DB.rec[u]={salt,ss,h:sh(pr,ss),vault};save();return{ok:1}}},
 /* --- магазин ★ --- */
 'shop/state':{f:u=>({bal:DB.bal[u]||0,admin:!!DB.admins[u],cfg:{rate:RATE,min:MINS,max:MAXS,ready:!!OWNER.card,card:OWNER.card,holder:OWNER.holder,bank:OWNER.bank,url:OWNER.url},
   gifts:GIFTS.map(g=>({...g,left:gLeft(g)})),
   orders:Object.values(DB.orders).filter(o=>o.u===u).sort((a,b)=>b.t-a.t).slice(0,10).map(({id,n,amt,rub,st,t})=>({id,n,amt,rub,st,t}))})},
 'shop/order':{f:(u,b)=>{if(!OWNER.card)throw err('Приём оплаты ещё не настроен владельцем');const a=Math.floor(+b.amt);
   if(!(a>=MINS&&a<=MAXS))throw err('Количество: от '+MINS+' до '+MAXS+' ★');
   if(Object.values(DB.orders).filter(o=>o.u===u&&(o.st==='new'||o.st==='claimed')).length>=5)throw err('Слишком много неоплаченных заказов — отмените ненужные');
   const o={id:'o'+Date.now().toString(36)+crypto.randomBytes(3).toString('hex'),n:++DB.ordn,u,amt:a,rub:Math.round(a*RATE*100)/100,st:'new',t:Date.now()};DB.orders[o.id]=o;save();
   return{order:{id:o.id,n:o.n,amt:o.amt,rub:o.rub,st:o.st,t:o.t}}}},
 'shop/paid':{f:(u,b)=>{const o=DB.orders[b.id];if(!o||o.u!==u||o.st!=='new')throw err('Заказ недоступен');o.st='claimed';o.note=String(b.note||'').slice(0,80);o.pt=Date.now();save();return{ok:1}}},
 'shop/cancel':{f:(u,b)=>{const o=DB.orders[b.id];if(!o||o.u!==u||o.st!=='new')throw err('Заказ недоступен');o.st='cancel';save();return{ok:1}}},
 /* --- подарок: списывает ★ у отправителя, пишет карточку в чат, добавляет в «Подарки» получателя --- */
 'gift/send':{f:(u,b)=>{const to=String(b.to||''),g=GIFTS.find(x=>x.id===b.gid);
   if(!g)throw err('Нет такого подарка');if(!DB.users[to]||to===u||to==='bot')throw err('Нельзя отправить подарок этому пользователю');
   if(isBl(u,to))throw err('Недоступно',403);if(DB.users[to].fonly&&!isFr(u,to))throw err('Пользователь принимает сообщения только от друзей',403);
   if(g.s&&(DB.gcount[g.id]||0)>=g.s)throw err('Этот подарок распродан');
   if((DB.bal[u]||0)<g.p)throw err('Недостаточно ★ — пополните баланс');
   DB.bal[u]-=g.p;const k=DB.gcount[g.id]=(DB.gcount[g.id]||0)+1,now=Date.now(),rnd=Math.random().toString(36).slice(2,6),
   gid='gf'+now+rnd,mid='m'+now+u.slice(-4)+rnd,gd={e:g.e,n:g.n,r:g.r,s:g.s||0},
   mv={c:[u,to].sort().join('_'),from:u,t:now,kind:'gift',body:g.id,gn:k,gd,rx:{},rd:0};
   DB.msgs[mid]=mv;DB.gifts[gid]={from:u,to,gid:g.id,...gd,k,t:now};DB.audit.push({t:now,u,n:-g.p,why:'gift '+g.id+' → '+to});save();
   broadcast('msgs',mid,mv);broadcast('gifts',gid,DB.gifts[gid]);pushBal(u);if(![...clients].some(cl=>cl.u===to))sendPush(to);return{ok:1,bal:DB.bal[u]}}},
 /* --- код разработчика: открывает режим владельца и зачисляет ★ (код задаётся ТОЛЬКО на сервере: DEV_CODE) --- */
 'dev/redeem':{f:(u,b,req)=>{if(DEV.length<8)throw err('Код разработчика не настроен на сервере (переменная DEV_CODE, от 8 символов)',403);
   const k='d:'+u,k2='di:'+ipOf(req);if(locked(k,5,9e5)||locked(k2,15,9e5))throw err('Слишком много попыток. Подождите 15 минут.',429);
   const h=x=>crypto.createHash('sha256').update(String(x)).digest();if(!crypto.timingSafeEqual(h(b.code||''),h(DEV))){fail(k);fail(k2);throw err('Неверный код',403)}
   const n=Math.floor(+b.amt)||0;if(n<0||n>1e9)throw err('Неверное количество');DB.admins[u]=true;if(n)credit(u,n,'dev code');else save();return{bal:DB.bal[u]||0,admin:true}}},
 /* --- панель владельца --- */
 'admin/list':{f:u=>{adm(u);return{orders:Object.values(DB.orders).filter(o=>o.st==='claimed'||o.st==='new').sort((a,b)=>(b.st==='claimed')-(a.st==='claimed')||b.t-a.t).slice(0,50).map(o=>({id:o.id,n:o.n,amt:o.amt,rub:o.rub,st:o.st,note:o.note||'',un:(DB.users[o.u]||{}).un}))}}},
 'admin/confirm':{f:(u,b)=>{adm(u);const o=DB.orders[b.id];if(!o||(o.st!=='claimed'&&o.st!=='new'))throw err('Заказ недоступен');o.st='done';o.dt=Date.now();
   credit(o.u,o.amt,'order #'+o.n);botMsg(o.u,'✅ Заказ №'+o.n+' оплачен: на ваш баланс зачислено '+o.amt+' ★. Приятных подарков! 🎁');sendPush(o.u);return{ok:1}}},
 'admin/reject':{f:(u,b)=>{adm(u);const o=DB.orders[b.id];if(!o||(o.st!=='claimed'&&o.st!=='new'))throw err('Заказ недоступен');o.st='rej';save();
   botMsg(o.u,'❌ Заказ №'+o.n+' отклонён: перевод не найден. Если вы оплатили — свяжитесь с владельцем приложения.');sendPush(o.u);return{ok:1}}},
 'admin/grant':{f:(u,b)=>{adm(u);const f=userByUn(b.un);if(!f)throw err('Пользователь не найден');const n=Math.floor(+b.amt);if(!(n>0&&n<=1e9))throw err('Неверное количество');
   credit(f[0],n,'grant by admin');botMsg(f[0],'🎁 Вам начислено '+n+' ★');return{ok:1}}}
};
const body=req=>new Promise((res,rej)=>{let n=0;const b=[];req.on('data',c=>{n+=c.length;if(n>1.5e6){rej(new Error('Слишком большой запрос'));req.destroy()}else b.push(c)});req.on('end',()=>res(Buffer.concat(b).toString()));req.on('error',rej)});
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x');
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  const J=(code,o)=>{if(res.headersSent)return;res.writeHead(code,{...cors,'Content-Type':'application/json'});res.end(JSON.stringify(o))};
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}
  try{
    if(url.pathname==='/api/ping')return J(200,{ok:1});
    if(url.pathname==='/api/stream'){
      const u=url.searchParams.get('u'),t=url.searchParams.get('t');if(!auth(u,t))return J(401,{err:'Нет доступа'});
      res.writeHead(200,{...cors,'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const cl={res,u};clients.add(cl);send(cl,{t:'init',s:state(u)});send(cl,{t:'bal',v:DB.bal[u]||0});
      const ka=setInterval(()=>{try{res.write(': ka\n\n')}catch(e){}},20000);req.on('close',()=>{clearInterval(ka);clients.delete(cl)});return}
    const ap=/^\/api\/([a-z]+\/[a-z]+)$/.exec(url.pathname);
    if(ap&&req.method==='POST'&&API[ap[1]]){const b=JSON.parse((await body(req))||'{}'),h=API[ap[1]];let u=null;if(!h.open){if(!auth(b.u,b.t))return J(401,{err:'Нет доступа'});u=b.u}return J(200,h.f(u,b,req))}
    if(url.pathname==='/api/w'&&req.method==='POST'){
      const{u,t,op,c,id,v}=JSON.parse(await body(req));
      if(!auth(u,t))return J(401,{err:'Нет доступа'});
      if(typeof id!=='string'||!/^[A-Za-z0-9_\-]{1,100}$/.test(id))return J(400,{err:'Неверный id'});
      if(c==='media'){if(op!=='set'||!v||typeof v.d!=='string'||v.d.length>250000)return J(400,{err:'Неверный файл'});
        const f=path.join(MEDIA,id);if(fs.existsSync(f))return J(409,{err:'Уже есть'});
        return fs.writeFile(f,v.d,e=>e?J(500,{err:'Ошибка диска'}):J(200,{ok:1}))}
      if(!COLS.includes(c)||!['set','update','delete'].includes(op))return J(400,{err:'Неверная операция'});
      const wasNew=op==='set'&&!DB[c][id];
      apply(u,op,c,id,v);
      /* пушим только тем, кто сейчас не на связи по SSE (иначе они и так увидят обновление в реальном времени) */
      if(wasNew&&c==='msgs'){const g=DB.groups[v.c],targets=g?(g.mem||[]).filter(x=>x!==u):String(v.c).split('_').filter(x=>x!==u);for(const t of targets)if(t!=='bot'&&![...clients].some(cl=>cl.u===t))sendPush(t)}
      if(wasNew&&c==='calls'&&v.to&&![...clients].some(cl=>cl.u===v.to))sendPush(v.to);
      return J(200,{ok:1})}
    const m=/^\/api\/doc\/media\/([A-Za-z0-9_\-]{1,100})$/.exec(url.pathname);
    if(m)return fs.readFile(path.join(MEDIA,m[1]),(e,d)=>{if(e)return J(404,{err:'Нет файла'});res.writeHead(200,{...cors,'Content-Type':'application/json','Cache-Control':'public, max-age=31536000'});res.end(JSON.stringify({d:d.toString()}))});
    if(url.pathname==='/'||url.pathname==='/index.html')return fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{if(e){res.writeHead(404);return res.end('index.html не найден рядом с server.js')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(d)});
    if(url.pathname==='/sw.js')return fs.readFile(path.join(__dirname,'sw.js'),(e,d)=>{if(e){res.writeHead(404);return res.end('sw.js не найден рядом с server.js')}res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-cache','Service-Worker-Allowed':'/'});res.end(d)});
    J(404,{err:'Не найдено'})
  }catch(e){J(typeof e.code==='number'?e.code:400,{err:e.message||'Ошибка'})}
});
server.listen(PORT,()=>console.log('Сириус запущен: http://localhost:'+PORT+'  (данные: '+DIR+')'));
