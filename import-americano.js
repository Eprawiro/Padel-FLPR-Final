const cheerio = require('cheerio');
const { getStore } = require('@netlify/blobs');

const ALLOWED_HOSTS = new Set(['americano-padel.com', 'www.americano-padel.com']);
const STORE_NAME = 'flpr-tournaments';

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'access-control-allow-origin':'*', 'access-control-allow-headers':'content-type,x-flpr-admin-key', 'access-control-allow-methods':'GET,POST,PATCH,OPTIONS' }, body: JSON.stringify(body) };
}
function canonicalize(raw) {
  const u = new URL(raw);
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) throw new Error('Only americano-padel.com URLs are allowed.');
  const match = u.pathname.match(/\/(?:r|print)\/([a-z0-9-]+)/i);
  if (!match) throw new Error('The URL does not contain a valid Americano tournament ID.');
  const id = match[1];
  return { id, sourceUrl: `https://americano-padel.com/print/${id}?ln=en` };
}
function cleanLines($) {
  $('script,style,noscript,svg').remove();
  return $('body').text().replace(/\r/g,'\n').split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
}
function parseTournament(html,id,sourceUrl) {
  const $=cheerio.load(html); const title=($('h1').first().text()||$('title').text()||'').replace(/\s+/g,' ').trim();
  const lines=cleanLines($), rounds=[]; let current=null,court=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i], rm=line.match(/^Round\s+(\d+)/i);
    if(rm){current={round:Number(rm[1]),matches:[]};rounds.push(current);court=null;continue;}
    const cm=line.match(/^Court\s*([A-Za-z0-9-]+)?/i); if(cm&&current){court=cm[1]||null;continue;}
    if(current&&i+3<lines.length){
      const chunk=lines.slice(i,i+4), reserved=/^(Round|Court|Toplist|Results?|Print|Americano|Mexicano|Share|Player|Points?|Games?|Sets?)\b/i;
      if(chunk.every(x=>!reserved.test(x))&&chunk.every(x=>x.length<=60)){
        let scoreA=null,scoreB=null,consumed=4; const next=lines[i+4]||'', score=next.match(/^(\d{1,3})\s*[-:]\s*(\d{1,3})$/);
        if(score){scoreA=Number(score[1]);scoreB=Number(score[2]);consumed=5;}
        current.matches.push({court,teamA:[chunk[0],chunk[1]],teamB:[chunk[2],chunk[3]],scoreA,scoreB}); i+=consumed-1;
      }
    }
  }
  if(!rounds.some(r=>r.matches.length)) $('table tr').each((_,tr)=>{
    const cells=$(tr).find('th,td').map((__,el)=>$(el).text().replace(/\s+/g,' ').trim()).get().filter(Boolean);
    if(cells.length>=5){const names=cells.filter(x=>!/^\d+\s*[-:]\s*\d+$/.test(x)&&!/^court/i.test(x));const sc=cells.find(x=>/^\d+\s*[-:]\s*\d+$/.test(x));if(names.length>=4){if(!rounds.length)rounds.push({round:1,matches:[]});const sm=sc&&sc.match(/^(\d+)\s*[-:]\s*(\d+)$/);rounds[0].matches.push({court:cells[0],teamA:names.slice(0,2),teamB:names.slice(2,4),scoreA:sm?Number(sm[1]):null,scoreB:sm?Number(sm[2]):null});}}
  });
  const matches=rounds.flatMap(r=>r.matches.map(m=>({...m,round:r.round}))), players=[...new Set(matches.flatMap(m=>[...m.teamA,...m.teamB]))].sort(), completed=matches.filter(m=>Number.isFinite(m.scoreA)&&Number.isFinite(m.scoreB)).length;
  return {externalTournamentId:id,source:'Americano Padel',sourceUrl,title:title||`Americano Tournament ${id}`,importedAt:new Date().toISOString(),status:'PENDING_REVIEW',countTowardRating:false,players,rounds,summary:{rounds:rounds.length,matches:matches.length,completedMatches:completed,players:players.length},parserVersion:'D2.2-premium.1'};
}
function store(){return getStore({name:STORE_NAME,consistency:'strong'});}
async function listAll(){const s=store();const {blobs}=await s.list({paginate:false});const items=[];for(const b of blobs){const x=await s.get(b.key,{type:'json',consistency:'strong'});if(x)items.push(x);}return items.sort((a,b)=>new Date(b.importedAt)-new Date(a.importedAt));}
function authorized(event){const expected=process.env.FLPR_ADMIN_KEY;return Boolean(expected)&&event.headers['x-flpr-admin-key']===expected;}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return json(200,{ok:true});
  try{
    if(event.httpMethod==='GET'){
      const items=await listAll(); return json(200,{ok:true,tournaments:items,summary:{pending:items.filter(x=>x.status==='PENDING_REVIEW').length,approved:items.filter(x=>x.status==='APPROVED').length,rejected:items.filter(x=>x.status==='REJECTED').length}});
    }
    if(event.httpMethod==='PATCH'){
      if(!authorized(event))return json(401,{ok:false,error:'Admin approval key is missing or incorrect.'});
      const payload=JSON.parse(event.body||'{}'), id=String(payload.id||''), action=String(payload.action||'').toUpperCase();
      if(!id||!['APPROVE','REJECT'].includes(action))return json(400,{ok:false,error:'Valid id and action are required.'});
      const s=store(), key=`tournament-${id.toLowerCase()}`, current=await s.get(key,{type:'json',consistency:'strong'}); if(!current)return json(404,{ok:false,error:'Tournament not found.'});
      current.status=action==='APPROVE'?'APPROVED':'REJECTED'; current.countTowardRating=action==='APPROVE'; current.reviewedAt=new Date().toISOString(); current.reviewNote=String(payload.note||'');
      await s.setJSON(key,current); return json(200,{ok:true,tournament:current,message:action==='APPROVE'?'Tournament approved and stored permanently. Official rating recalculation must use the FLPR engine pipeline.':'Tournament rejected.'});
    }
    if(event.httpMethod!=='POST')return json(405,{ok:false,error:'GET, POST or PATCH required'});
    const payload=JSON.parse(event.body||'{}'); if(!payload.url)return json(400,{ok:false,error:'Tournament URL is required.'});
    const {id,sourceUrl}=canonicalize(payload.url), s=store(), key=`tournament-${id.toLowerCase()}`, existing=await s.get(key,{type:'json',consistency:'strong'});
    if(existing)return json(409,{ok:false,error:'Duplicate tournament ID detected.',tournament:existing});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    const res=await fetch(sourceUrl,{signal:controller.signal,headers:{'user-agent':'FLPR-Premium/1.0 (+Netlify Function)','accept':'text/html,application/xhtml+xml'}});clearTimeout(timer);
    if(!res.ok)return json(502,{ok:false,error:`Americano server returned HTTP ${res.status}.`,sourceUrl});
    const html=await res.text();if(!html||html.length<100)return json(502,{ok:false,error:'The tournament page returned insufficient content.',sourceUrl});
    const tournament=parseTournament(html,id,sourceUrl),warnings=[];if(!tournament.summary.matches)warnings.push('No matches were recognized.');if(tournament.summary.completedMatches<tournament.summary.matches)warnings.push('Some matches do not have recognized scores.');
    await s.setJSON(key,tournament,{onlyIfNew:true});return json(200,{ok:true,tournament,warnings,persisted:true});
  }catch(err){return json(400,{ok:false,error:err.name==='AbortError'?'Americano server request timed out.':err.message});}
};
