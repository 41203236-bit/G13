
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, onValue, get, runTransaction, update } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const params = new URLSearchParams(location.search);
const roomCode = (params.get('room') || localStorage.getItem('gy_room_code') || '').trim().toUpperCase();
let mySlot = (params.get('slot') || localStorage.getItem('gy_room_slot') || 'O').toUpperCase() === 'X' ? 'X' : 'O';
const playerId = localStorage.getItem('gy_player_id') || '';
if(!roomCode) location.href = 'menu.html';
const roomDbRef = ref(db, `rooms/${roomCode}`);
const battleDbRef = ref(db, `rooms/${roomCode}/battle`);

const ROLE_IMG = { mage:'mage.png', knight:'knight.png', assassin:'assassin.png' };
const factionName = (f)=> f==='dark' ? '暗' : '光';
const sounds={tap:new Audio('sounds/tap.mp3'),atk:new Audio('sounds/atk.mp3'),def:new Audio('sounds/def.mp3'),hel:new Audio('sounds/hel.mp3'),stn:new Audio('sounds/stn.mp3'),tick:new Audio('sounds/tick.mp3')};
let roomCache=null, state=null, timerInt=null, roomUnsub=null, floatingEventKey='';
const WIN_LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const $ = (id)=>document.getElementById(id);
const syncOverlay = $('syncOverlay');
$('roomCode').textContent = roomCode;

function playSound(name){ const s=sounds[name]; if(!s) return; s.pause(); s.currentTime=0; s.play().catch(()=>{}); }
function stopSound(name){ const s=sounds[name]; if(!s) return; s.pause(); s.currentTime=0; }
function defaultData(){ return { hp:100, sp:0, ult:0, skillUsed:0, stunned:0, defending:false, darkStacks:0 }; }
function normalizeRoom(raw){ return raw && typeof raw==='object' ? raw : {}; }
function normalizeBattle(raw){ const b=raw&&typeof raw==='object'?raw:{}; return {
  playerConfig: { O:{ ...(b.playerConfig?.O||{}) }, X:{ ...(b.playerConfig?.X||{}) } },
  turn: b.turn==='X'?'X':'O',
  turnEndsAt: Number.isFinite(b.turnEndsAt)?b.turnEndsAt:(Date.now()+60000),
  placedThisTurn: !!b.placedThisTurn,
  grid: Array.isArray(b.grid)? b.grid.map(v=>v==='X'?'X':v==='O'?'O':null).slice(0,9).concat(Array(9).fill(null)).slice(0,9) : Array(9).fill(null),
  queues: { O: Array.isArray(b.queues?.O)?b.queues.O:[], X:Array.isArray(b.queues?.X)?b.queues.X:[] },
  data: { O:{...defaultData(), ...(b.data?.O||{})}, X:{...defaultData(), ...(b.data?.X||{})} },
  winner: b.winner==='X'?'X':(b.winner==='O'?'O':null),
  lastEvent: b.lastEvent || null
}; }
function buildSpDots(sp){ let html=''; for(let i=0;i<5;i++){ const seg=Math.max(0,Math.min(20,sp-i*20)); const fill=(seg/20)*100; html+=`<div class="sp-dot-wrap"><div class="sp-dot-base"></div><div class="sp-dot-fill" style="clip-path: inset(${100-fill}% 0 0 0)"></div></div>`; } return html; }
function buildUltDots(ult){ let html=''; for(let i=0;i<5;i++){ const seg=Math.max(0,Math.min(20,ult-i*20)); const fill=(seg/20)*100; html+=`<div class="ult-dot-wrap"><div class="ult-dot-base"></div><div class="ult-dot-fill" style="clip-path: inset(${100-fill}% 0 0 0)"></div></div>`; } return html; }
function buildBoard(){ const board=$('board'); board.innerHTML=''; for(let i=0;i<9;i++){ const d=document.createElement('div'); d.className='cell'; d.id='c-'+i; d.addEventListener('click',()=>tapOnline(i)); board.appendChild(d);} }
function updateBadges(){ const pc=state.playerConfig; ['O','X'].forEach(p=>{ const cfg=pc[p]||{}; $('badge-'+p).textContent = `${factionName(cfg.faction)} / ${p}`; $('avatar-'+p).src = ROLE_IMG[cfg.role] || (p==='O'?'mage.png':'assassin.png'); }); }
function renderBoard(){ for(let i=0;i<9;i++){ const v=state.grid[i]; const el=$('c-'+i); el.innerText = v==='O'?'◯':v==='X'?'✕':''; el.className = 'cell ' + (v||''); if(v && state.queues[v]?.length===3 && state.queues[v][0]===i) el.classList.add('warning-cell'); } }
function updateUI(){ if(!state) return; const pc=state.playerConfig; updateBadges(); $('turnText').textContent = `目前回合：${factionName(pc[state.turn]?.faction)} / ${state.turn}`; ['O','X'].forEach(p=>{ const hp=state.data[p].hp; $('hp-fill-'+p).style.clipPath=`inset(${100-hp}% 0 0 0)`; $('hp-ghost-'+p).style.clipPath=`inset(${100-hp}% 0 0 0)`; $('hp-val-'+p).innerText=Math.floor(hp)+'%'; $('hp-val-'+p).style.top=`calc(${100-hp}% + 10px)`; $('sp-display-'+p).innerHTML=buildSpDots(state.data[p].sp); $('ult-display-'+p).innerHTML=buildUltDots(state.data[p].ult); $('sp-text-'+p).innerText=`SP ${state.data[p].sp} / 100`; $('ult-text-'+p).innerText=`ULT ${state.data[p].ult} / 100`; $('buff-text-'+p).innerText = pc[p].faction==='dark' ? `直排增加傷害 ${state.data[p].darkStacks||0} 層` : '直排：當下回復 8 HP'; $('panel-'+p).className='side-panel'+(state.turn===p?' active-side-'+p:''); $('avatar-'+p).classList.toggle('stunned-avatar', state.data[p].stunned>0); $('hp-fill-'+p).classList.toggle('defending-bar', !!state.data[p].defending); });
  let dots=''; const myData=state.data[mySlot]; for(let i=0;i<3;i++) dots += `<div class="u-dot ${i < (3-myData.skillUsed) ? 'fill' : ''}"></div>`; $('usage-dots-container').innerHTML=dots;
  const canSkillBase = roomCache.phase==='playing' && state.turn===mySlot && state.placedThisTurn && !state.winner;
  const skills=[{t:'atk',c:20},{t:'def',c:40},{t:'hel',c:40},{t:'stn',c:60}];
  $('skill-list-container').innerHTML = skills.map(s=>{ const can=canSkillBase && myData.sp>=s.c && myData.skillUsed<3; return `<button class="s-btn btn-${s.t} ${can?'active':''}" data-skill="${s.t}"></button>`; }).join('');
  document.querySelectorAll('[data-skill]').forEach(btn=>btn.addEventListener('click',()=>useSkill(btn.dataset.skill)));
  $('endTurnBtn').disabled = !(roomCache.phase==='playing' && state.turn===mySlot && state.placedThisTurn);
  renderBoard();
  showFloatingIfNeeded();
}
function showFloatingIfNeeded(){ const ev = state.lastEvent; if(!ev) return; const key = JSON.stringify(ev); if(key===floatingEventKey) return; floatingEventKey = key; const box='hp-box-'+(ev.owner||'O'); if(ev.sp) showFloatText(box, `+${ev.sp} SP`, '#71e9ff'); if(ev.heal) setTimeout(()=>showFloatText(box, `+${ev.heal} HP`, '#52d273'), 120); if(ev.stacks) setTimeout(()=>showFloatText(box, `增加傷害 ${state.data[ev.owner].darkStacks} 層`, '#d7a6ff'), 240); }
function showFloatText(id,txt,col){ const box=$(id); if(!box) return; const el=document.createElement('div'); el.className='float-text'; el.innerText=txt; el.style.color=col; el.style.left='0'; box.appendChild(el); setTimeout(()=>el.remove(),900); }
function isVertical(line){ return (line[0]===0&&line[1]===3&&line[2]===6)||(line[0]===1&&line[1]===4&&line[2]===7)||(line[0]===2&&line[1]===5&&line[2]===8); }
function collectWins(grid,slot){ return WIN_LINES.filter(line => line.every(i => grid[i]===slot)); }
function calcLineSp(line){ return line.includes(4) ? 40 : 20; }
function nextTurnState(cur){ const s = JSON.parse(JSON.stringify(cur)); const current=s.turn; const next = current==='O'?'X':'O'; if(s.data[current].stunned>0) s.data[current].stunned--; s.data[current].skillUsed=0; s.turn=next; s.placedThisTurn=false; s.turnEndsAt=Date.now()+60000; return s; }
function renderTimer(){ if(!state || roomCache.phase!=='playing'){ $('timer-container').textContent='--'; return; } const remain=Math.max(0, Math.ceil((state.turnEndsAt-Date.now())/1000)); $('timer-container').textContent=String(remain); $('timer-container').classList.toggle('timer-warn', remain<=10); }
async function tickTimeout(){ if(!roomCache || roomCache.phase!=='playing' || !state || state.winner) return; renderTimer(); const remain = state.turnEndsAt - Date.now(); if(remain<=0 && roomCache.host===mySlot){ await runTransaction(battleDbRef, cur=>{ if(!cur) return cur; cur = normalizeBattle(cur); if(cur.turn!==mySlot || cur.winner) return cur; return nextTurnState(cur); }); } }
async function tapOnline(i){ if(!state || roomCache.phase!=='playing') return; await runTransaction(battleDbRef, cur=>{ if(!cur) return cur; cur=normalizeBattle(cur); if(cur.turn!==mySlot || cur.winner || cur.placedThisTurn || cur.grid[i]) return cur; const q = cur.queues[mySlot] || []; if(q.length>=3){ const removed=q.shift(); cur.grid[removed]=null; }
    cur.grid[i]=mySlot; q.push(i); cur.queues[mySlot]=q; cur.placedThisTurn=true; const wins=collectWins(cur.grid,mySlot); let sp=0, heal=0, stacks=0; if(wins.length){ const unique=[...new Set(wins.flat())]; wins.forEach(line=>{ sp += calcLineSp(line); if(isVertical(line)){ const f=cur.playerConfig?.[mySlot]?.faction; if(f==='light') heal += 8; else if(f==='dark') stacks += 1; } }); unique.forEach(idx=>{ cur.grid[idx]=null; cur.queues.O=(cur.queues.O||[]).filter(v=>v!==idx); cur.queues.X=(cur.queues.X||[]).filter(v=>v!==idx); }); }
    cur.data[mySlot].sp=Math.min(100,(cur.data[mySlot].sp||0)+sp); if(heal) cur.data[mySlot].hp=Math.min(100,cur.data[mySlot].hp+heal); if(stacks) cur.data[mySlot].darkStacks=Math.min(2,(cur.data[mySlot].darkStacks||0)+stacks); cur.lastEvent={ owner:mySlot, sp, heal, stacks, at:Date.now() };
    return cur; });
}
async function useSkill(type){ if(!state || roomCache.phase!=='playing') return; const cost = type==='atk'?20:type==='stn'?60:40; const ultGain = type==='atk'?25:type==='stn'?35:20;
  await runTransaction(battleDbRef, cur=>{ if(!cur) return cur; cur=normalizeBattle(cur); const me=cur.data[mySlot], foe=cur.data[mySlot==='O'?'X':'O']; if(cur.turn!==mySlot || cur.winner || !cur.placedThisTurn || me.skillUsed>=3 || me.sp<cost) return cur; me.sp-=cost; me.skillUsed+=1; me.ult=Math.min(100,(me.ult||0)+ultGain);
    if(type==='atk'){ let dmg=10; if(me.darkStacks>=1) dmg+=2; if(me.darkStacks>=2){ dmg+=2; if(Math.random()<0.4) dmg+=4; } me.darkStacks=0; if(foe.defending){ dmg=Math.max(0,dmg-5); foe.defending=false; } foe.hp=Math.max(0,foe.hp-dmg); cur.lastEvent={ owner: mySlot==='O'?'X':'O', sp:0, heal:0, stacks:0, dmg, at:Date.now() }; if(foe.hp<=0) cur.winner=mySlot; }
    else if(type==='def'){ me.defending=true; cur.lastEvent={owner:mySlot, sp:0, heal:0, stacks:0, at:Date.now()}; }
    else if(type==='hel'){ me.hp=Math.min(100,me.hp+8); cur.lastEvent={owner:mySlot, sp:0, heal:8, stacks:0, at:Date.now()}; }
    else if(type==='stn'){ foe.stunned=Math.max(foe.stunned||0,1); cur.lastEvent={owner:mySlot==='O'?'X':'O', sp:0, heal:0, stacks:0, at:Date.now()}; }
    return cur; });
}
async function endTurn(auto=false){ if(!state || roomCache.phase!=='playing') return; await runTransaction(battleDbRef, cur=>{ if(!cur) return cur; cur=normalizeBattle(cur); if(cur.turn!==mySlot && !auto) return cur; if(cur.winner) return cur; return nextTurnState(cur); }); }
function attachRoom(){ if(roomUnsub) roomUnsub(); roomUnsub = onValue(roomDbRef, snap=>{ const room=normalizeRoom(snap.val()); roomCache=room; if(!room || !room.players || !room.battle){ if(syncOverlay) syncOverlay.style.display='flex'; return; }
    if(playerId){ if(room.players.O?.clientId===playerId) mySlot='O'; else if(room.players.X?.clientId===playerId) mySlot='X'; }
    state = normalizeBattle(room.battle); const ready = room.phase==='playing' && state.playerConfig?.O?.role && state.playerConfig?.X?.role;
    if(syncOverlay) syncOverlay.style.display = ready ? 'none' : 'flex';
    updateUI(); renderTimer();
  });
}
async function ensureBattle(){ const snap=await get(roomDbRef); const room=normalizeRoom(snap.val()); if(!room.players?.O?.role || !room.players?.X?.role) return; if(room.battle) return; if(room.host!==mySlot) return; const battle={ playerConfig:{ O:{ name:room.players.O.name, role:room.players.O.role, faction:room.players.O.faction, clientId:room.players.O.clientId }, X:{ name:room.players.X.name, role:room.players.X.role, faction:room.players.X.faction, clientId:room.players.X.clientId } }, turn:'O', turnEndsAt: Date.now()+60000, placedThisTurn:false, grid:Array(9).fill(null), queues:{O:[],X:[]}, data:{O:defaultData(),X:defaultData()}, winner:null, lastEvent:null };
  await update(roomDbRef, { battle, phase:'playing' });
}
function setupControls(){ $('endTurnBtn').addEventListener('click', ()=>endTurn(false)); document.addEventListener('keydown', async (e)=>{ if(e.code!=='Space') return; if(!state || roomCache.phase!=='playing' || state.turn!==mySlot) return; if((state.data[mySlot].ult||0)<100) return; e.preventDefault(); await runTransaction(battleDbRef, cur=>{ if(!cur) return cur; cur=normalizeBattle(cur); if(cur.turn!==mySlot || cur.data[mySlot].ult<100) return cur; cur.data[mySlot].ult=0; cur.lastEvent={owner:mySlot, sp:0, heal:0, stacks:0, at:Date.now(), ult:true}; return cur; }); }); $('btnBackMenu').onclick=()=>location.href='menu.html'; $('btnRematch').onclick=()=>location.reload(); }
function maybeShowResult(){ if(!state?.winner) return; const overlay=$('resultOverlay'), card=$('resultCard'), title=$('resultTitle'), sub=$('resultSub'); overlay.classList.add('show'); const win=state.winner===mySlot; card.className='result-card '+(win?'win':'lose'); title.textContent=win?'勝利':'失敗'; sub.textContent=win?'你成功擊敗對手':'這一局很可惜'; }

buildBoard(); setupControls(); ensureBattle().then(attachRoom); renderTimer(); timerInt=setInterval(async()=>{ await tickTimeout(); maybeShowResult(); }, 250);
