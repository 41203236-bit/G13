
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, get, set, update, onValue, remove, off } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const STORAGE = {
  playerName: 'gy_player_name',
  playerId: 'gy_player_id',
  faction: 'gy_menu_faction',
  role: 'gy_menu_role',
  roomCode: 'gy_room_code',
  slot: 'gy_room_slot'
};
const ROLE_DATA = {
  mage: { label:'法師 · Mage', short:'控場 / 封鎖 / 節奏限制', passiveName:'殘影禁制', passiveDesc:'當法師落下第 4 顆棋並移除最舊棋時，該位置留下 1 回合殘影格。對手若落在該格，下回合主動技能消耗 +1 SP。冷卻 2 回合。', activeName:'封格', activeDesc:'指定 1 個空格，對手下回合不能落子在該格。', image:'mage.png' },
  knight: { label:'騎士 · Knight', short:'穩定推進 / 保持盤面壓力', passiveName:'堅守陣線', passiveDesc:'當騎士落下第 4 顆棋時，自動保留最舊棋一次，不立即移除。冷卻 2 回合。', activeName:'推進', activeDesc:'將自己場上一顆棋移動到相鄰空格。', image:'knight.png' },
  assassin: { label:'刺客 · Assassin', short:'擾亂節奏 / 打斷布局', passiveName:'弱點標記', passiveDesc:'當刺客落下第 4 顆棋時，使對手最舊棋脆弱 1 回合。冷卻 3 回合。', activeName:'突襲換位', activeDesc:'將自己一顆棋與相鄰敵棋交換位置。', image:'assassin.png' }
};
const FACTION_LABEL = { light:'光', dark:'暗' };

const $ = (id)=>document.getElementById(id);
const els = {
  playerNameText: $('playerNameText'), factionLight: $('factionLight'), factionDark: $('factionDark'),
  createBtn: $('createBtn'), copyBtn: $('copyBtn'), roomInput: $('roomInput'), joinBtn: $('joinBtn'),
  readyBtn: $('readyBtn'), leaveBtn: $('leaveBtn'), startBtn: $('startBtn'), statusBar: $('statusBar'),
  roomCodeText: $('roomCodeText'), roomRoleText: $('roomRoleText'),
  mySlotChip: $('mySlotChip'), myRoleName: $('myRoleName'), myRoleSub: $('myRoleSub'), myRoleImage: $('myRoleImage'), myRolePlaceholder: $('myRolePlaceholder'), myPassiveName: $('myPassiveName'), myPassiveDesc: $('myPassiveDesc'), myActiveName: $('myActiveName'), myActiveDesc: $('myActiveDesc'),
  enemySlotChip: $('enemySlotChip'), enemyRoleName: $('enemyRoleName'), enemyRoleSub: $('enemyRoleSub'), enemyRoleImage: $('enemyRoleImage'), enemyRolePlaceholder: $('enemyRolePlaceholder'), enemyPassiveName: $('enemyPassiveName'), enemyPassiveDesc: $('enemyPassiveDesc'), enemyActiveName: $('enemyActiveName'), enemyActiveDesc: $('enemyActiveDesc'),
  playerOneName: $('playerOneName'), playerOneMeta: $('playerOneMeta'), playerOneState: $('playerOneState'), playerTwoName: $('playerTwoName'), playerTwoMeta: $('playerTwoMeta'), playerTwoState: $('playerTwoState'),
  toast: $('toast')
};
const roleCards = [...document.querySelectorAll('.role-card')];

let playerName = localStorage.getItem(STORAGE.playerName) || '';
let playerId = localStorage.getItem(STORAGE.playerId) || '';
let selectedFaction = localStorage.getItem(STORAGE.faction) || '';
let selectedRole = localStorage.getItem(STORAGE.role) || '';
let currentRoomCode = localStorage.getItem(STORAGE.roomCode) || '';
let currentSlot = localStorage.getItem(STORAGE.slot) || '';
let roomData = null;
let roomUnsub = null;
let navigating = false;
if (!playerName) location.href = 'entry_page_v4_centered_layout.html';
if (!playerId) { playerId = 'p_' + Math.random().toString(36).slice(2,10); localStorage.setItem(STORAGE.playerId, playerId); }

function showToast(msg){ if(!els.toast) return; els.toast.textContent=msg; els.toast.classList.add('show'); clearTimeout(showToast.t); showToast.t=setTimeout(()=>els.toast.classList.remove('show'),1800); }
function setStatus(msg){ if(els.statusBar) els.statusBar.textContent=msg; }
function roomRef(code){ return ref(db, `rooms/${code}`); }
function codeGen(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function cleanup(){ if(roomUnsub){ off(roomRef(currentRoomCode), 'value', roomUnsub); roomUnsub=null; } }
function persistSelection(){ localStorage.setItem(STORAGE.faction, selectedFaction||''); localStorage.setItem(STORAGE.role, selectedRole||''); }
function setFaction(f){ selectedFaction=f; persistSelection(); render(); }
function setRole(r){ selectedRole=r; persistSelection(); render(); }
function playerStateText(p){ if(!p?.joined) return ['未加入','bad']; if(p.ready) return ['已準備','ok']; return ['未準備','warn']; }
function renderRole(panel, role, slotText, emptyText){
  const data = role ? ROLE_DATA[role] : null;
  if (panel==='me'){
    els.mySlotChip.textContent = slotText;
    if(data){ els.myRoleName.textContent=data.label; els.myRoleSub.textContent=data.short; els.myRoleImage.src=data.image; els.myRoleImage.classList.remove('hidden'); els.myRolePlaceholder.style.display='none'; els.myPassiveName.textContent=data.passiveName; els.myPassiveDesc.textContent=data.passiveDesc; els.myActiveName.textContent=data.activeName; els.myActiveDesc.textContent=data.activeDesc; }
    else { els.myRoleName.textContent='待選擇'; els.myRoleSub.textContent=emptyText; els.myRoleImage.classList.add('hidden'); els.myRolePlaceholder.style.display='block'; els.myPassiveName.textContent='—'; els.myPassiveDesc.textContent='尚未選角。'; els.myActiveName.textContent='—'; els.myActiveDesc.textContent='尚未選角。'; }
  } else {
    els.enemySlotChip.textContent = slotText;
    if(data){ els.enemyRoleName.textContent=data.label; els.enemyRoleSub.textContent=data.short; els.enemyRoleImage.src=data.image; els.enemyRoleImage.classList.remove('hidden'); els.enemyRolePlaceholder.style.display='none'; els.enemyPassiveName.textContent=data.passiveName; els.enemyPassiveDesc.textContent=data.passiveDesc; els.enemyActiveName.textContent=data.activeName; els.enemyActiveDesc.textContent=data.activeDesc; }
    else { els.enemyRoleName.textContent='待同步顯示'; els.enemyRoleSub.textContent=emptyText; els.enemyRoleImage.classList.add('hidden'); els.enemyRolePlaceholder.style.display='block'; els.enemyPassiveName.textContent='—'; els.enemyPassiveDesc.textContent='等待同步。'; els.enemyActiveName.textContent='—'; els.enemyActiveDesc.textContent='等待同步。'; }
  }
}
function canReady(room){
  if(!currentRoomCode || !currentSlot || !selectedRole || !selectedFaction) return false;
  const me = room?.players?.[currentSlot];
  if(!me?.joined) return false;
  const otherSlot = currentSlot==='O'?'X':'O';
  const other = room?.players?.[otherSlot];
  if(other?.joined && other.faction && other.faction===selectedFaction) return false;
  return room?.phase === 'lobby';
}
function render(){
  els.playerNameText.textContent = playerName || '未載入';
  els.factionLight.classList.toggle('active', selectedFaction==='light');
  els.factionDark.classList.toggle('active', selectedFaction==='dark');
  roleCards.forEach(card=>card.classList.toggle('active', card.dataset.role===selectedRole));
  const slotLabel = currentSlot ? `${FACTION_LABEL[selectedFaction]||'未選'} / ${currentSlot}` : '我的角色';
  renderRole('me', selectedRole, slotLabel, '請先選陣營與角色。');
  const room = roomData;
  const players = room?.players || { O:{}, X:{} };
  const otherSlot = currentSlot==='O'?'X':'O';
  const enemy = currentSlot ? players[otherSlot] : null;
  renderRole('enemy', enemy?.role || '', enemy?.joined ? `${FACTION_LABEL[enemy?.faction]||'未選'} / ${otherSlot}` : '對手角色', enemy?.joined ? '對手已加入，等待完成選角。' : '對手尚未加入或尚未選角。');

  els.roomCodeText.textContent = currentRoomCode || '未建立';
  els.roomRoleText.textContent = currentSlot ? `你是 ${currentSlot==='O'?'房主 O':'房客 X'}` : '尚未加入房間';
  const [oState,oCls] = playerStateText(players.O); const [xState,xCls] = playerStateText(players.X);
  els.playerOneName.textContent = players.O?.name || '等待中'; els.playerOneMeta.textContent = players.O?.joined ? `${FACTION_LABEL[players.O?.faction]||'未選'} · ${ROLE_DATA[players.O?.role]?.label||'未選角'}` : '尚未加入'; els.playerOneState.textContent=oState; els.playerOneState.className=`state ${oCls}`;
  els.playerTwoName.textContent = players.X?.name || '等待中'; els.playerTwoMeta.textContent = players.X?.joined ? `${FACTION_LABEL[players.X?.faction]||'未選'} · ${ROLE_DATA[players.X?.role]?.label||'未選角'}` : '尚未加入'; els.playerTwoState.textContent=xState; els.playerTwoState.className=`state ${xCls}`;

  els.copyBtn.disabled = !currentRoomCode;
  els.leaveBtn.disabled = !currentRoomCode;
  const me = currentSlot ? players[currentSlot] : null;
  els.readyBtn.disabled = !canReady(room);
  els.readyBtn.textContent = me?.ready ? '取消準備' : '準備就緒';
  const bothJoined = players.O?.joined && players.X?.joined;
  const bothReady = players.O?.ready && players.X?.ready;
  const validFactions = players.O?.faction && players.X?.faction && players.O.faction !== players.X.faction;
  els.startBtn.disabled = !(currentSlot==='O' && room?.phase==='lobby' && bothJoined && bothReady && validFactions);
  if(!currentRoomCode) setStatus('請先選擇陣營與角色，再建立或加入房間。');
  else if(!bothJoined) setStatus('等待另一位玩家加入。');
  else if(!validFactions) setStatus(`陣營衝突：另一位玩家已選 ${FACTION_LABEL[players.O?.faction||players.X?.faction]||'未選'}，請改成另一個陣營。`);
  else if(!bothReady) setStatus('雙方完成準備後，由房主開始。');
  else setStatus('雙方準備完成，房主可開始。');
}
async function createRoom(){
  if(!selectedRole || !selectedFaction){ showToast('先選陣營與角色'); return; }
  const code = codeGen();
  currentRoomCode = code; currentSlot = 'O';
  localStorage.setItem(STORAGE.roomCode, code); localStorage.setItem(STORAGE.slot,'O');
  const room = { phase:'lobby', host:'O', createdAt:Date.now(), players:{ O:{ joined:true, ready:false, name:playerName, clientId:playerId, role:selectedRole, faction:selectedFaction }, X:{ joined:false, ready:false, name:'', clientId:'', role:'', faction:'' } } };
  await set(roomRef(code), room);
  subscribe(code);
  showToast('新房間已建立');
}
async function joinRoom(){
  const code = (els.roomInput.value || '').trim().toUpperCase();
  if(!code){ showToast('先輸入房號'); return; }
  if(!selectedRole || !selectedFaction){ showToast('先選陣營與角色'); return; }
  const snap = await get(roomRef(code));
  if(!snap.exists()){ showToast('找不到這個房間'); return; }
  const room = snap.val();
  if(room.phase !== 'lobby'){ showToast('房間已開始'); return; }
  const hostFaction = room.players?.O?.faction || '';
  if(hostFaction && hostFaction === selectedFaction){ setStatus(`麻煩你更改陣營選項改成${hostFaction==='light'?'暗':'光'}的部分。`); showToast('陣營不能和房主相同'); return; }
  currentRoomCode = code; currentSlot = 'X';
  localStorage.setItem(STORAGE.roomCode, code); localStorage.setItem(STORAGE.slot,'X');
  await update(roomRef(code), { 'players/X': { joined:true, ready:false, name:playerName, clientId:playerId, role:selectedRole, faction:selectedFaction } });
  subscribe(code);
  showToast('加入房間成功');
}
async function toggleReady(){
  if(!currentRoomCode || !currentSlot || !roomData) return;
  const path = `players/${currentSlot}`;
  const me = roomData.players?.[currentSlot] || {};
  const other = roomData.players?.[currentSlot==='O'?'X':'O'] || {};
  if(other?.joined && other?.faction && other.faction === selectedFaction){ setStatus(`麻煩你更改陣營選項改成${selectedFaction==='light'?'暗':'光'}的部分。`); return; }
  await update(roomRef(currentRoomCode), {
    [`${path}/name`]: playerName,
    [`${path}/clientId`]: playerId,
    [`${path}/role`]: selectedRole,
    [`${path}/faction`]: selectedFaction,
    [`${path}/joined`]: true,
    [`${path}/ready`]: !me.ready
  });
}
function initBattle(room){
  return {
    playerConfig: {
      O: { name: room.players.O.name, role: room.players.O.role, faction: room.players.O.faction, clientId: room.players.O.clientId },
      X: { name: room.players.X.name, role: room.players.X.role, faction: room.players.X.faction, clientId: room.players.X.clientId }
    },
    turn: 'O',
    turnEndsAt: Date.now() + 60000,
    placedThisTurn: false,
    grid: Array(9).fill(null),
    queues: { O: [], X: [] },
    data: {
      O: { hp:100, sp:0, ult:0, skillUsed:0, stunned:0, defending:false, darkStacks:0 },
      X: { hp:100, sp:0, ult:0, skillUsed:0, stunned:0, defending:false, darkStacks:0 }
    },
    winner: null,
    lastEvent: null
  };
}
async function startBattle(){
  if(!currentRoomCode || currentSlot!=='O') return;
  const snap = await get(roomRef(currentRoomCode));
  if(!snap.exists()) return;
  const room = snap.val();
  const pO = room.players?.O, pX = room.players?.X;
  if(!(pO?.joined && pX?.joined && pO?.ready && pX?.ready)) { showToast('雙方都要準備'); return; }
  if(!(pO?.role && pO?.faction && pO?.clientId && pX?.role && pX?.faction && pX?.clientId)) { showToast('玩家資料不完整'); return; }
  if(pO.faction === pX.faction){ showToast('房間內只能一光一暗'); return; }
  await update(roomRef(currentRoomCode), { battle: initBattle(room), phase:'playing', startedAt: Date.now() });
}
async function leaveRoom(){
  if(!currentRoomCode || !currentSlot) return;
  const code=currentRoomCode, slot=currentSlot;
  cleanup();
  if(slot==='O') await remove(roomRef(code));
  else await update(roomRef(code), { 'players/X': { joined:false, ready:false, name:'', clientId:'', role:'', faction:'' }, battle:null, phase:'lobby' });
  currentRoomCode=''; currentSlot=''; roomData=null; localStorage.removeItem(STORAGE.roomCode); localStorage.removeItem(STORAGE.slot); render();
}
function goBattle(){
  if(navigating || !currentRoomCode || !currentSlot) return;
  navigating = true;
  location.href = `game.html?room=${encodeURIComponent(currentRoomCode)}&slot=${encodeURIComponent(currentSlot)}`;
}
function subscribe(code){
  cleanup();
  roomUnsub = onValue(roomRef(code), snap => {
    const room = snap.val();
    if(!room){ currentRoomCode=''; currentSlot=''; roomData=null; render(); setStatus('房間不存在或已被刪除'); return; }
    roomData = room;
    render();
    if(room.phase === 'playing' && room.battle?.playerConfig?.O?.role && room.battle?.playerConfig?.X?.role) setTimeout(goBattle, 120);
  });
}
function restore(){ if(currentRoomCode) subscribe(currentRoomCode); render(); }

els.factionLight.addEventListener('click', ()=>setFaction('light'));
els.factionDark.addEventListener('click', ()=>setFaction('dark'));
roleCards.forEach(card => card.addEventListener('click', ()=>setRole(card.dataset.role)));
els.createBtn.addEventListener('click', createRoom);
els.joinBtn.addEventListener('click', joinRoom);
els.readyBtn.addEventListener('click', toggleReady);
els.leaveBtn.addEventListener('click', leaveRoom);
els.startBtn.addEventListener('click', startBattle);
els.copyBtn.addEventListener('click', async()=>{ if(currentRoomCode){ await navigator.clipboard.writeText(currentRoomCode); showToast('房號已複製'); } });
restore();
