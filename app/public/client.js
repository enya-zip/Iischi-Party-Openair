import {setup, validateAction, applyAction} from './logic.js';
import {copy} from './strings.js';
import {setupLeaderboard} from './leaderboard.js';
import {TRACKS,trackById,createMusic} from './music.js';
const $=id=>document.getElementById(id);
const canvas=$('game-canvas'),ctx=canvas.getContext('2d');
const DURATION=45,LOOKAHEAD=1.6,HIT_WINDOW=.18,COLORS=['#d1ff2b','#fd73ff','#aa38fd'],BEST_KEY='iischi-party-best-v2';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const number=n=>Math.round(n).toLocaleString('de-CH');
let reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const fields={};['score','combo','time-left','phase-name','feedback','final-score','final-message','final-accuracy','final-combo','best-score','start-best','result-status','sound-label','share-status'].forEach(id=>fields[id]=$(id));
const put=(id,v)=>{if(fields[id])fields[id].textContent=v};
const laneButtons=[...document.querySelectorAll('[data-lane]')];
let rules=setup(['solo']),notes=rules.notes,state='idle',score=0,combo=0,maxCombo=0,hitCount=0,totalDeviation=0;
let elapsed=0,startedAt=0,countdownStartedAt=0,countdownNumber='',raf=0,lastFrame=0,lastHudSecond=-1,lastTickAt=-100;
let lastRun=null,runCounter=0,feedbackUntil=0,width=340,height=360,particles=[],laneFlash=[0,0,0],best=0,previousBest=0;
let soundEnabled=true,audioContext=null,audioMaster=null,noiseBuffer=null,audioOrigin=0,nextAudioStep=0;
const audioVoices=new Set();
const music=createMusic();let audioClock=false;
let track=TRACKS[0];try{track=trackById(localStorage.getItem('iischi-track'));}catch{}
const victorySound=new Audio('assets/victory.mp3');victorySound.volume=.28;victorySound.preload='none';
try{const n=Number(localStorage.getItem(BEST_KEY));if(Number.isFinite(n)&&n>=0&&n<=27600)best=n;const mute=localStorage.getItem('iischi-sound');if(mute!==null)soundEnabled=mute==='on';if(localStorage.getItem('iischi-reduced-motion')==='on')reducedMotion=true;}catch{}
put('start-best',number(best));put('best-score',number(best));
if($('reduce-motion'))$('reduce-motion').checked=reducedMotion;
function showScreen(name){['start','play','result'].forEach(s=>$(s+'-screen').hidden=s!==name);document.body.dataset.screen=name;}
function showOverlay(id,v){$(id).hidden=!v;}
function setControls(){laneButtons.forEach(b=>b.disabled=state!=='playing');$('pause-game').textContent=state==='paused'?copy.resume:copy.pause;$('pause-game').disabled=state==='countdown';$('pause-game').setAttribute('aria-label',state==='paused'?copy.resume:copy.pause);}
function updateHud(force=false){const sec=Math.max(0,Math.ceil(DURATION-elapsed));if(force||sec!==lastHudSecond){put('time-left',sec);lastHudSecond=sec;}put('score',number(score));put('combo',combo);put('phase-name',copy.phases[phaseIndex()]);$('progress-fill').style.width=(elapsed/DURATION*100)+'%';$('party-meter').style.width=Math.min(100,combo/30*100)+'%';}
function say(t,c='#f6f4f0'){put('feedback',t);fields.feedback.style.color=c;feedbackUntil=elapsed+.6;}
function action(a){const valid=validateAction(rules,'solo',a);if(!valid.ok)return false;const oldEvent=rules.eventId;rules=applyAction(rules,'solo',a);notes=rules.notes;score=rules.score;combo=rules.combo;maxCombo=rules.maxCombo;hitCount=rules.hits;totalDeviation=rules.totalDeviation;
if(rules.eventId!==oldEvent){const e=rules.lastEvent;if(e.kind==='hit'){say(copy.quality[e.quality]+(e.multiplier>1?' · ×'+e.multiplier:''),COLORS[e.lane]);addParticles(e.lane,COLORS[e.lane]);}else if(e.kind==='wrong')say(copy.wrong,'#fd73ff');else if(e.kind==='miss')say(copy.keepGoing,'#fd73ff');}
updateHud();return true;}
    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width || 340);
      height = Math.max(1, rect.height || 360);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now());
    }

    function addParticles(lane, color) {
      if (reducedMotion) return;
      const x = (lane + 0.5) * width / 3;
      const y = height * 0.75;
      for (let i = 0; i < 10; i += 1) {
        const angle = (i / 10) * Math.PI * 2 + elapsed;
        const speed = 35 + (i % 4) * 22;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 25, life: 0.5, color });
      }
    }

    function draw(now) {
      const dt = Math.min(0.04, lastFrame ? (now - lastFrame) / 1000 : 0);
      lastFrame = now;
      const moving = state === 'playing';
      const laneWidth = width / 3;
      const hitY = height * 0.75;
      const topY = -20;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#090909e8';
      ctx.fillRect(0, 0, width, height);

      // Quiet lane rails; the target band communicates timing without audio.
      for (let lane = 0; lane < 3; lane += 1) {
        if (moving) laneFlash[lane] = Math.max(0, laneFlash[lane] - dt * 3);
        ctx.fillStyle = COLORS[lane];
        ctx.globalAlpha = 0.035 + laneFlash[lane] * 0.12;
        ctx.fillRect(lane * laneWidth + 1, 0, laneWidth - 2, hitY + 22);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff16';
        ctx.lineWidth = 1;
        if (lane > 0) {
          ctx.beginPath(); ctx.moveTo(lane * laneWidth, 0); ctx.lineTo(lane * laneWidth, hitY + 23); ctx.stroke();
        }
        const bandHeight = (hitY - topY) * HIT_WINDOW / LOOKAHEAD;
        ctx.fillStyle = COLORS[lane];
        ctx.globalAlpha = 0.1;
        ctx.fillRect(lane * laneWidth + 8, hitY - bandHeight, laneWidth - 16, bandHeight * 2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS[lane];
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(lane * laneWidth + 8, hitY); ctx.lineTo((lane + 1) * laneWidth - 8, hitY); ctx.stroke();
        ctx.globalAlpha = 0.6 + laneFlash[lane] * 0.4;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc((lane + 0.5) * laneWidth, hitY, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Notes are intentionally simple and high contrast on small phone screens.
      notes.forEach((note) => {
        if (note.status !== 0) return;
        const remaining = note.t / 1000 - elapsed;
        if (remaining > LOOKAHEAD + 0.15 || remaining < -HIT_WINDOW) return;
        const x = (note.lane + 0.5) * laneWidth;
        const y = hitY - remaining / LOOKAHEAD * (hitY - topY);
        const radius = Math.min(23, laneWidth * 0.21);
        ctx.fillStyle = COLORS[note.lane];
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#09090988';
        ctx.lineWidth = 1;
        [0.56, 0.75].forEach((factor) => {
          ctx.beginPath(); ctx.arc(x, y, radius * factor, 0, Math.PI * 2); ctx.stroke();
        });
        ctx.fillStyle = '#090909';
        ctx.beginPath(); ctx.arc(x, y, radius * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      });

      particles.forEach((particle) => {
        if (moving) {
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vy += 95 * dt;
          particle.life -= dt;
        }
        ctx.globalAlpha = Math.max(0, particle.life / 0.5);
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x, particle.y, 3, 3);
      });
      particles = particles.filter((particle) => particle.life > 0);
      ctx.globalAlpha = 1;

      // The crowd grows and raises its arms as the combo increases.
      const crowdY = height - 13;
      const crowdCount = Math.max(11, Math.floor(width / 20));
      for (let i = 0; i < crowdCount; i += 1) {
        const x = (i + 0.5) * width / crowdCount;
        const energy = Math.min(1, combo / 24);
        const bounce = reducedMotion ? 0 : Math.sin(elapsed * 6 + i * 1.9) * (1 + energy * 3);
        const headY = crowdY - 11 - bounce - (i % 3) * 2;
        ctx.strokeStyle = combo > 9 && i % 3 === 0 ? COLORS[i % 3] : '#ffffff42';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, headY, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, headY + 7); ctx.lineTo(x, height + 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 9, headY + 10 - energy * 20);
        ctx.lineTo(x - 4, headY + 13);
        ctx.lineTo(x + 4, headY + 13);
        ctx.lineTo(x + 9, headY + 10 - energy * 20);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }


async function unlockAudio(){if(!soundEnabled)return;try{if(!audioContext){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error();audioContext=new AC({latencyHint:'interactive'});audioContext.addEventListener('statechange',()=>{if(audioContext.state!=='running'&&state==='playing')pauseGame();});music.attach(audioContext);void music.load(track).catch(()=>{});audioMaster=audioContext.createGain();audioMaster.gain.value=.16;audioMaster.connect(audioContext.destination);noiseBuffer=audioContext.createBuffer(1,audioContext.sampleRate*.12,audioContext.sampleRate);const a=noiseBuffer.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1;}if(audioContext.state==='suspended')await audioContext.resume();}catch{soundEnabled=false;updateSoundButton();}}
function voice(node,gain,extra){audioVoices.add(node);node.onended=()=>{audioVoices.delete(node);try{node.disconnect();gain.disconnect();if(extra)extra.disconnect();}catch{}};}
function stopAudio(){audioVoices.forEach(n=>{try{n.stop();}catch{}});audioVoices.clear();music.stop();victorySound.pause();}
function updateSoundButton(){$('sound-toggle').setAttribute('aria-pressed',String(soundEnabled));$('sound-toggle').setAttribute('aria-label',soundEnabled?copy.soundOff:copy.soundOn);put('sound-label',soundEnabled?copy.soundIsOn:copy.soundIsOff);}
function menuMusic(){if(soundEnabled&&audioContext&&audioContext.state==='running'&&(state==='idle'||state==='finished')){void music.play(track,0,audioContext.currentTime+0.05);}}
function scheduleFrame(){if(!raf)raf=requestAnimationFrame(frame);}
function gameTime(now){if(audioClock){const t=music.now();if(t!==null)return t;}return (now-startedAt)/1000;}
function phaseIndex(){const b=elapsed*rules.bpm/60;return b<36?0:b<64?1:2;}
function frame(now){raf=0;if(state==='countdown'){let left;if(audioClock){const t=music.now();left=t===null?3:Math.min(3,Math.ceil(elapsed-t-1e-6));}else left=3-Math.floor((now-countdownStartedAt)/1000);if(left<=0){showOverlay('countdown-overlay',false);state='playing';if(!audioClock)startedAt=now-elapsed*1000;setControls();say(elapsed===0?copy.hitLine:copy.continue,'#d1ff2b');}else if(String(left)!==countdownNumber){countdownNumber=String(left);$('countdown-number').textContent=countdownNumber;}}
if(state==='playing'){elapsed=Math.max(rules.lastAt/1000,clamp(gameTime(now),0,45));const at=Math.max(rules.lastAt,Math.floor(elapsed*1000));if(at-lastTickAt>=80||at>=45000){if(action({type:'tick',at}))lastTickAt=at;}if(elapsed>feedbackUntil)put('feedback',combo>=10?copy.crowd:'');updateHud();if(elapsed>=45){finishGame();return;}}
draw(now);if(state==='playing'||state==='countdown')scheduleFrame();}
function startCountdown(){music.stop();state='countdown';countdownStartedAt=performance.now();countdownNumber='3';$('countdown-number').textContent='3';audioClock=Boolean(soundEnabled&&audioContext&&audioContext.state==='running');if(audioClock){const when=audioContext.currentTime+0.05;void music.play(track,elapsed-3,when);}showOverlay('pause-overlay',false);showOverlay('countdown-overlay',true);setControls();lastFrame=0;scheduleFrame();}
async function startGame(){if(raf)cancelAnimationFrame(raf);raf=0;stopAudio();rules=setup(['solo'],{bpm:track.bpm});notes=rules.notes;score=0;combo=0;maxCombo=0;hitCount=0;totalDeviation=0;elapsed=0;lastHudSecond=-1;lastTickAt=-100;nextAudioStep=0;particles=[];laneFlash=[0,0,0];previousBest=best;leaderboard.reset();put('share-status','');put('feedback','');showScreen('play');updateHud(true);resizeCanvas();document.querySelector('.game-console').scrollIntoView({block:'start',behavior:reducedMotion?'auto':'smooth'});if(soundEnabled)await unlockAudio();startCountdown();}
function pauseGame(){if(state!=='playing'&&state!=='countdown')return;if(state==='playing')elapsed=Math.max(rules.lastAt/1000,clamp(gameTime(performance.now()),0,45));state='paused';if(raf)cancelAnimationFrame(raf);raf=0;stopAudio();showOverlay('countdown-overlay',false);showOverlay('pause-overlay',true);setControls();updateHud();draw(performance.now());}
async function resumeGame(){if(state!=='paused')return;if(soundEnabled)await unlockAudio();startCountdown();}
function exitGame(){state='idle';if(raf)cancelAnimationFrame(raf);raf=0;stopAudio();showOverlay('pause-overlay',false);showOverlay('countdown-overlay',false);showScreen('start');setControls();put('start-best',number(best));$('start-game').focus({preventScroll:true});menuMusic();}
function finishGame(){if(state==='finished')return;if(!rules.done)action({type:'finish',at:45000});state='finished';if(raf)cancelAnimationFrame(raf);raf=0;stopAudio();const accuracy=Math.round(hitCount/notes.length*100);lastRun={id:++runCounter,score,accuracy,maxCombo};try{const stored=Number(localStorage.getItem(BEST_KEY));if(Number.isFinite(stored)&&stored>=0&&stored<=27600)best=Math.max(best,stored);}catch{}if(score>best){best=score;try{localStorage.setItem(BEST_KEY,String(best));}catch{}}put('final-score',number(score));put('final-accuracy',accuracy+'%');put('final-combo',maxCombo);put('best-score',number(best));put('start-best',number(best));put('final-message',copy.results[accuracy>=90?0:accuracy>=65?1:accuracy>=35?2:3]);put('result-status',score>previousBest&&score>0?copy.newBest:copy.localScore);$('result-screen').dataset.timingDeviationMs=String(Math.round(totalDeviation));showOverlay('pause-overlay',false);showOverlay('countdown-overlay',false);showScreen('result');setControls();$('to-board').focus({preventScroll:true});if(soundEnabled){victorySound.currentTime=0;victorySound.play().catch(()=>{});menuMusic();}}
function tapLane(lane){if(state!=='playing'||lane<0||lane>2)return;elapsed=Math.max(rules.lastAt/1000,clamp(gameTime(performance.now()),0,45));if(elapsed>=45){finishGame();return;}if(!action({type:'tap',at:Math.max(rules.lastAt,Math.floor(elapsed*1000)),lane}))return;laneFlash[lane]=1;const button=laneButtons[lane];button.classList.add('is-hit');setTimeout(()=>button.classList.remove('is-hit'),100);}
laneButtons.forEach(b=>{b.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();tapLane(Number(b.dataset.lane));});b.addEventListener('click',e=>{if(e.detail===0)tapLane(Number(b.dataset.lane));});});
canvas.addEventListener('pointerdown',e=>{if(e.button>0||state!=='playing')return;e.preventDefault();const r=canvas.getBoundingClientRect();tapLane(clamp(Math.floor((e.clientX-r.left)/r.width*3),0,2));});
document.addEventListener('keydown',e=>{if(e.target&&(e.target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))return;if(e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;const keys={KeyA:0,KeyS:1,KeyD:2,ArrowLeft:0,ArrowDown:1,ArrowRight:2};if(state==='playing'&&Object.hasOwn(keys,e.code)){e.preventDefault();tapLane(keys[e.code]);}else if(e.code==='Escape'&&(state==='playing'||state==='countdown')){e.preventDefault();pauseGame();}});
$('start-game').addEventListener('click',startGame);$('play-again').addEventListener('click',startGame);$('exit-game').addEventListener('click',exitGame);$('pause-game').addEventListener('click',()=>state==='paused'?resumeGame():pauseGame());
$('sound-toggle').addEventListener('click',async()=>{soundEnabled=!soundEnabled;updateSoundButton();try{localStorage.setItem('iischi-sound',soundEnabled?'on':'off');}catch{}if(soundEnabled){await unlockAudio();if(!soundEnabled||!audioContext)return;if(state==='playing'){const e=clamp(gameTime(performance.now()),0,45);audioClock=true;void music.play(track,e+0.05,audioContext.currentTime+0.05);}else if(state==='countdown'){startCountdown();}else menuMusic();}else{if(state==='playing'&&audioClock){elapsed=Math.max(rules.lastAt/1000,clamp(gameTime(performance.now()),0,45));startedAt=performance.now()-elapsed*1000;}else if(state==='countdown'&&audioClock){countdownStartedAt=performance.now();}audioClock=false;stopAudio();}});
$('share-score').addEventListener('click',async()=>{const message=copy.share.replace('{score}',number(score))+' '+location.origin+'/';try{await navigator.clipboard.writeText(message);put('share-status',copy.copied);}catch{put('share-status',message);}});
if($('reduce-motion'))$('reduce-motion').addEventListener('change',e=>{reducedMotion=e.target.checked;try{localStorage.setItem('iischi-reduced-motion',reducedMotion?'on':'off');}catch{}});
document.addEventListener('iischi:pause',pauseGame);document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseGame();stopAudio();}});window.addEventListener('blur',()=>{pauseGame();});window.addEventListener('resize',resizeCanvas,{passive:true});new ResizeObserver(resizeCanvas).observe(canvas);
const leaderboard=setupLeaderboard({getRun:()=>lastRun});
function renderTracks(){const box=$('track-options');if(!box)return;box.replaceChildren(...TRACKS.map(t=>{const b=document.createElement('button');b.type='button';b.className='track-option';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(t.id===track.id));b.dataset.track=t.id;const n=document.createElement('strong');n.textContent=t.name;const m=document.createElement('span');m.textContent=t.style+' · '+t.bpm+' BPM';b.append(n,m);b.addEventListener('click',async()=>{track=t;try{localStorage.setItem('iischi-track',t.id);}catch{}renderTracks();if(soundEnabled){await unlockAudio();menuMusic();}});return b;}));}
renderTracks();
updateSoundButton();updateHud(true);setControls();resizeCanvas();
