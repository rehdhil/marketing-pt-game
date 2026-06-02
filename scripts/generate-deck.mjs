// Generates a self-contained, offline-capable backup slide deck from questions.json.
// Logos are embedded as base64 so the single HTML file works anywhere.
// Output: "Marketing PT Game - Backup Deck.html" in the project root.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions.json'), 'utf8'));
const LOGO_DIR = path.join(ROOT, 'public/assets/logos');

function logoDataUri(file) {
  try {
    const buf = fs.readFileSync(path.join(LOGO_DIR, file));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

const PROMPT = { whoami: 'Who am I?', problem: 'Who solves this?', referral: 'Who do you refer?' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const slides = [];

// ---- title ----
slides.push(`<section class="slide title">
  <div class="kicker">BNI Infinity · Marketing Power Team</div>
  <h1 class="display">Guess the<br><span class="gold">Marketing Member's</span><br>Business!</h1>
  <p class="sub">3 rounds · 30 questions · buzz in to win the mega prize 🎁</p>
  <div class="hint">Press → or Space to begin</div>
</section>`);

let overall = 0;
const total = data.rounds.reduce((a, r) => a + r.questions.length, 0);

for (const round of data.rounds) {
  // round divider
  slides.push(`<section class="slide divider">
    <div class="round-num">Round ${round.round}</div>
    <h2 class="display">${esc(round.title.replace(/^Round \d+ — /, ''))}</h2>
    <p class="sub">${esc(round.subtitle || '')}</p>
  </section>`);

  round.questions.forEach((q, i) => {
    overall++;
    const clues = (q.clues || []).map((c) => `<li>${esc(c)}</li>`).join('');
    // question slide
    slides.push(`<section class="slide question" data-round="${round.round}">
      <div class="qhead">
        <span class="badge">Round ${round.round} · ${esc(round.title.replace(/^Round \d+ — /, ''))}</span>
        <span class="qnum">Q${i + 1} / ${round.questions.length}</span>
      </div>
      <ul class="clues">${clues}</ul>
      <div class="prompt">${esc(PROMPT[q.type] || 'Who am I?')}</div>
    </section>`);
    // reveal slide
    const uri = logoDataUri(q.logo);
    const logoHtml = uri
      ? `<div class="logo-wrap"><img src="${uri}" alt="${esc(q.businessName)}"></div>`
      : `<div class="logo-wrap text"><span>${esc(q.businessName)}</span></div>`;
    slides.push(`<section class="slide reveal" data-round="${round.round}">
      <div class="answer-badge">✓ Answer</div>
      ${logoHtml}
      <h2 class="biz display">${esc(q.businessName)}</h2>
      <div class="cat">${esc(q.category || '')}</div>
      <div class="member">— ${esc(q.memberName)}</div>
    </section>`);
  });
}

// ---- closing ----
slides.push(`<section class="slide title closing">
  <h1 class="display">🏆<br>Winner takes the<br><span class="gold">Mega Prize!</span></h1>
  <p class="sub">Thank you for playing · BNI Infinity Marketing PT</p>
</section>`);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marketing PT Game — Backup Deck</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Poppins:wght@400;600;700;800&display=swap');
:root{
  --bg0:#0b0b2b; --bg1:#1a0f3d; --bg2:#2b1259; --ink:#fff; --dim:#b9b6e6;
  --gold:#ffd23f; --pink:#ff4d8d; --good:#2bd97c;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#000;overflow:hidden;font-family:'Poppins',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink)}
.display{font-family:'Fredoka','Poppins',sans-serif;font-weight:700;letter-spacing:.3px}
.gold{color:var(--gold)}
#stageWrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
#stage{position:relative;width:1920px;height:1080px;transform-origin:center center;flex:0 0 auto}
.slide{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:120px 140px;
  background:
   radial-gradient(1400px 800px at 12% -8%, var(--bg2), transparent 60%),
   radial-gradient(1100px 700px at 112% 8%, #3a1a6b, transparent 55%),
   linear-gradient(160deg, var(--bg1), var(--bg0));}
.slide.active{display:flex}

/* title */
.title h1{font-size:120px;line-height:1.04}
.title .kicker{font-size:30px;letter-spacing:.32em;text-transform:uppercase;color:var(--dim);margin-bottom:40px}
.title .sub{font-size:38px;color:var(--dim);margin-top:48px}
.title .hint{position:absolute;bottom:70px;font-size:24px;color:rgba(255,255,255,.4);letter-spacing:.1em}
.closing h1{font-size:110px;line-height:1.05}

/* divider */
.divider .round-num{font-size:40px;letter-spacing:.3em;text-transform:uppercase;color:var(--gold);margin-bottom:24px}
.divider h2{font-size:96px;line-height:1.05}
.divider .sub{font-size:34px;color:var(--dim);margin-top:40px;max-width:1300px}

/* question */
.question{justify-content:flex-start;padding:80px 120px 72px}
.qhead{display:flex;align-items:center;justify-content:space-between;width:100%;margin-bottom:34px;flex:0 0 auto}
.badge{font-size:27px;font-weight:700;color:#1a0f3d;background:var(--gold);padding:11px 24px;border-radius:999px}
.qnum{font-size:29px;font-weight:800;color:var(--dim)}
.clues{list-style:none;display:flex;flex-direction:column;justify-content:center;gap:20px;width:100%;max-width:1520px;margin:0 auto;flex:1 1 auto}
.clues li{font-size:43px;line-height:1.26;font-weight:500;text-align:left;padding:22px 36px;border-radius:20px;
  background:rgba(255,255,255,.06);border-left:9px solid var(--gold)}
.prompt{font-family:'Fredoka',sans-serif;font-size:58px;font-weight:700;color:var(--gold);margin-top:24px;flex:0 0 auto}

/* reveal */
.reveal .answer-badge{font-size:30px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#04240f;background:var(--good);padding:12px 30px;border-radius:999px;margin-bottom:50px}
.logo-wrap{display:flex;align-items:center;justify-content:center;margin-bottom:44px}
.logo-wrap img{max-width:760px;max-height:380px;object-fit:contain;border-radius:24px}
.logo-wrap.text span{font-family:'Fredoka',sans-serif;font-size:96px;font-weight:700}
.reveal .biz{font-size:88px;line-height:1.06;max-width:1500px}
.reveal .cat{font-size:40px;color:var(--dim);margin-top:18px}
.reveal .member{font-size:46px;color:var(--gold);margin-top:30px;font-weight:700}

/* chrome */
#counter{position:fixed;bottom:22px;right:30px;z-index:50;font-size:18px;color:rgba(255,255,255,.5);
  font-family:monospace;letter-spacing:.1em;background:rgba(0,0,0,.35);padding:6px 14px;border-radius:999px}
#progress{position:fixed;top:0;left:0;height:5px;background:var(--gold);z-index:50;transition:width .25s ease}
</style>
</head>
<body>
<div id="progress"></div>
<div id="stageWrap"><div id="stage">${slides.join('\n')}</div></div>
<div id="counter"></div>
<script>
const stage=document.getElementById('stage');
const slides=[...stage.querySelectorAll('.slide')];
const counter=document.getElementById('counter');
const progress=document.getElementById('progress');
const KEY='ptg_deck_idx';
let idx=Math.min(slides.length-1,Math.max(0,parseInt(localStorage.getItem(KEY)||'0',10)||0));

function fit(){
  const s=Math.min(window.innerWidth/1920,window.innerHeight/1080);
  stage.style.transform='scale('+s+')';
}
function show(){
  slides.forEach((s,i)=>s.classList.toggle('active',i===idx));
  counter.textContent=(idx+1)+' / '+slides.length;
  progress.style.width=((idx+1)/slides.length*100)+'%';
  localStorage.setItem(KEY,idx);
}
function go(d){idx=Math.min(slides.length-1,Math.max(0,idx+d));show();}
window.addEventListener('resize',fit);
window.addEventListener('keydown',e=>{
  if(['ArrowRight',' ','PageDown','Enter'].includes(e.key)){e.preventDefault();go(1);}
  else if(['ArrowLeft','PageUp','Backspace'].includes(e.key)){e.preventDefault();go(-1);}
  else if(e.key==='Home'){idx=0;show();}
  else if(e.key==='End'){idx=slides.length-1;show();}
  else if(e.key==='f'||e.key==='F'){if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen();}
});
document.addEventListener('click',e=>{ if(e.clientX < window.innerWidth*0.18) go(-1); else go(1); });
fit();show();
</script>
</body>
</html>`;

const out = path.join(ROOT, 'Marketing PT Game - Backup Deck.html');
fs.writeFileSync(out, html);
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`✅ wrote ${out}\n   ${slides.length} slides, ${kb} KB (logos embedded), ${total} questions`);
