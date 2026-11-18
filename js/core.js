/* ============================================================
   赌徒模拟器 · 通用工具 / 牌堆 / 音效
   ============================================================ */
(function (C) {
  'use strict';

  let uidSeed = 0;

  const util = {
    randomInt(max) {
      return Math.floor(Math.random() * max);
    },
    randInt(min, max) {
      return Math.floor(min + Math.random() * (max - min + 1));
    },
    rand(min, max) {
      return min + Math.random() * (max - min);
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },
    clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    },
    roundTo(v, step) {
      if (!step) return Math.round(v);
      return Math.round(v / step) * step;
    },
    uid(prefix) {
      uidSeed += 1;
      return (prefix || 'id') + uidSeed;
    },
    escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    },
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    /* $1,234 / -$1,234 */
    fmt(n) {
      const v = Math.round(Number(n) || 0);
      return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
    },
    fmtSigned(n) {
      const v = Math.round(Number(n) || 0);
      if (v > 0) return '+$' + v.toLocaleString('en-US');
      if (v < 0) return '-$' + Math.abs(v).toLocaleString('en-US');
      return '$0';
    },
    /* 大额数字压缩显示，用于狭窄的 HUD */
    fmtCompact(n) {
      const v = Math.round(Number(n) || 0);
      const abs = Math.abs(v);
      const sign = v < 0 ? '-' : '';
      if (abs >= 100000000) return sign + '$' + (abs / 100000000).toFixed(2).replace(/\.?0+$/, '') + '亿';
      if (abs >= 10000) return sign + '$' + (abs / 10000).toFixed(1).replace(/\.0$/, '') + '万';
      return sign + '$' + abs.toLocaleString('en-US');
    },
    pct(v, digits) {
      return (v * 100).toFixed(digits == null ? 0 : digits) + '%';
    },
    plural(n, one, many) {
      return n + ' ' + (n === 1 ? one : many);
    }
  };

  C.util = util;

  /* ---------- 牌堆 ---------- */

  const deck = {
    create(includeJokers) {
      const out = [];
      const suits = C.DATA.SUITS;
      const ranks = C.DATA.RANKS;
      for (let s = 0; s < suits.length; s++) {
        for (let r = 0; r < ranks.length; r++) {
          const rank = ranks[r];
          out.push({
            uid: util.uid('card'),
            suit: suits[s].symbol,
            suitName: suits[s].name,
            suitIdx: s,
            rank: rank,
            value: C.DATA.RANK_VALUES[rank],
            red: suits[s].red,
            joker: false
          });
        }
      }
      if (includeJokers) {
        out.push({
          uid: util.uid('card'), suit: 'JOKER', suitName: '王', suitIdx: -1,
          rank: '小王', value: 16, red: false, joker: true
        });
        out.push({
          uid: util.uid('card'), suit: 'JOKER', suitName: '王', suitIdx: -1,
          rank: '大王', value: 17, red: true, joker: true
        });
      }
      return out;
    },
    shuffle(arr) {
      return util.shuffle(arr);
    },
    label(card) {
      if (!card) return '';
      if (card.joker) return card.rank;
      return card.suit + card.rank;
    },
    sortDesc(cards) {
      return cards.slice().sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return a.suitIdx - b.suitIdx;
      });
    },
    sortAsc(cards) {
      return cards.slice().sort((a, b) => {
        if (a.value !== b.value) return a.value - b.value;
        return a.suitIdx - b.suitIdx;
      });
    }
  };

  C.cards = deck;

  /* ---------- 本地存档（失败时静默） ---------- */

  C.storage = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  /* ---------- 合成音效（无外部素材） ---------- */

  const sound = (function () {
    let ctx = null;
    let enabled = C.storage.get('casino.sound', true) !== false;
    let master = null;

    const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };

    function ensure() {
      if (!enabled) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) {
        try {
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.55;
          master.connect(ctx.destination);
        } catch (e) {
          ctx = null;
          return null;
        }
      }
      if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) { /* ignore */ }
      }
      return ctx;
    }

    function tone(freq, dur, type, gain, when, slideTo) {
      const ac = ensure();
      if (!ac) return;
      const t0 = ac.currentTime + (when || 0);
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(Math.max(30, freq), t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain || 0.05), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function play(name) {
      if (!enabled) return;
      switch (name) {
        case 'click':
          tone(520, 0.06, 'triangle', 0.04);
          break;
        case 'chip':
          tone(1100, 0.05, 'triangle', 0.035);
          tone(1500, 0.06, 'triangle', 0.025, 0.035);
          break;
        case 'deal':
          tone(220, 0.08, 'sawtooth', 0.025, 0, 140);
          break;
        case 'flip':
          tone(340, 0.09, 'square', 0.025, 0, 680);
          break;
        case 'win':
          [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => tone(f, 0.22, 'triangle', 0.055, i * 0.09));
          break;
        case 'bigwin':
          [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => tone(f, 0.3, 'triangle', 0.06, i * 0.11));
          break;
        case 'lose':
          [NOTE.G4, NOTE.F4, NOTE.E4, NOTE.C4].forEach((f, i) => tone(f, 0.24, 'sine', 0.05, i * 0.1));
          break;
        case 'achievement':
          [NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => tone(f, 0.32, 'sine', 0.055, i * 0.12));
          break;
        case 'loan':
          tone(180, 0.18, 'sawtooth', 0.04);
          tone(240, 0.22, 'sawtooth', 0.035, 0.08);
          break;
        case 'cut':
          tone(90, 0.35, 'sawtooth', 0.04, 0, 55);
          break;
        case 'drill':
          tone(120, 0.28, 'sawtooth', 0.035, 0, 70);
          tone(160, 0.22, 'square', 0.02, 0.1, 90);
          break;
        case 'gusher':
          [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone(f, 0.26, 'triangle', 0.05, i * 0.08));
          break;
        case 'blowout':
          tone(70, 0.6, 'sawtooth', 0.06, 0, 35);
          tone(140, 0.35, 'square', 0.03, 0.05, 60);
          break;
        case 'valve':
          tone(300, 0.1, 'square', 0.03, 0, 180);
          break;
        case 'reveal':
          tone(420, 0.3, 'sine', 0.04, 0, 840);
          break;
        default:
          break;
      }
    }

    return {
      play,
      get enabled() { return enabled; },
      setEnabled(v) {
        enabled = !!v;
        C.storage.set('casino.sound', enabled);
        if (enabled) play('click');
      },
      toggle() {
        this.setEnabled(!enabled);
        return enabled;
      },
      unlock() { ensure(); }
    };
  })();

  C.sound = sound;
})(window.Casino = window.Casino || {});
