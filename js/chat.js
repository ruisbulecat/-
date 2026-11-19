/* ============================================================
   赌徒模拟器 · 牌桌聊天（局域网多人）
   文字 / 表情 / 图片。消息走 Net 中继，图片在浏览器里压缩成 data URL。
   ============================================================ */
(function (C) {
  'use strict';

  const FALLBACK = {
    maxText: 300,
    maxHistory: 80,
    imageMaxSide: 560,
    imageQuality: 0.68,
    imageMaxChars: 180000,
    minIntervalMs: 450,
    emojis: [
      '😀', '😄', '😁', '😂', '🤣', '😊', '😉', '😎',
      '😏', '😅', '😭', '😡', '🤔', '😱', '🤫', '😴',
      '🥺', '😈', '🤡', '👻', '💀', '🤖', '🎩', '💃',
      '🕵️', '🧔', '🥃', '🍻', '🍺', '🍷', '🃏', '🎲',
      '🔥', '💥', '✨', '🎉', '❤️', '💔', '👍', '👎',
      '👏', '🙏', '🤝', '👀', '💯', '✅', '❓', '🤑'
    ]
  };

  const IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

  function conf() {
    const base = (C.DATA && C.DATA.CHAT) || {};
    return Object.assign({}, FALLBACK, base, {
      emojis: (base.emojis && base.emojis.length) ? base.emojis : FALLBACK.emojis
    });
  }

  /* 只保留可打印字符，压缩空白，截断长度 */
  function cleanText(value, max) {
    const limit = Number(max) > 0 ? Number(max) : conf().maxText;
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .slice(0, limit);
  }

  /* 只接受浏览器生成的位图 data URL，拒绝 SVG / 远程地址 / 脚本 */
  function isSafeImage(value, maxChars) {
    const limit = Number(maxChars) > 0 ? Number(maxChars) : conf().imageMaxChars;
    return typeof value === 'string' &&
      value.length > 32 &&
      value.length <= limit &&
      IMAGE_RE.test(value);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatTime(at) {
    const date = new Date(Number(at) || Date.now());
    if (isNaN(date.getTime())) return '';
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function compressImage(img, settings) {
    const cfg = settings || conf();
    const maxSide = Number(cfg.imageMaxSide) || FALLBACK.imageMaxSide;
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) throw new Error('这张图片读不出来。');
    if (naturalW > 12000 || naturalH > 12000) throw new Error('图片尺寸太大，换一张试试。');
    const ratio = Math.min(1, maxSide / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * ratio));
    const height = Math.max(1, Math.round(naturalH * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法处理图片。');
    ctx.fillStyle = '#0c1b15';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const limit = Number(cfg.imageMaxChars) || FALLBACK.imageMaxChars;
    let quality = Number(cfg.imageQuality) || FALLBACK.imageQuality;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > limit && quality > 0.32) {
      quality -= 0.07;
      data = canvas.toDataURL('image/jpeg', quality);
    }
    if (data.length > limit) throw new Error('图片压缩后还是太大，换一张小一点的试试。');
    return data;
  }

  function mount(host, options) {
    if (!host) return null;
    const opts = options || {};
    const settings = conf();
    const selfId = opts.selfId || null;
    const messages = [];
    let destroyed = false;
    let collapsed = !!(window.matchMedia && window.matchMedia('(max-width: 860px)').matches);
    let unread = 0;
    let emojiOpen = false;
    let pendingImage = null;
    let lastSentAt = 0;
    let lightbox = null;

    host.classList.remove('hidden');
    host.classList.add('liar-chat');
    host.innerHTML = `
      <div class="liar-chat__head" data-chat-head>
        <span class="liar-chat__head-icon" aria-hidden="true">💬</span>
        <div class="liar-chat__title">
          <strong>牌桌聊天</strong>
          <small>文字 · 表情 · 图片</small>
        </div>
        <span class="liar-chat__badge hidden" data-chat-badge>0</span>
        <button class="liar-chat__toggle" type="button" data-chat-toggle aria-expanded="true">收起</button>
      </div>
      <div class="liar-chat__body">
        <div class="liar-chat__list" data-chat-list role="log" aria-live="polite">
          <p class="liar-chat__empty">还没有人说话。发个表情打个招呼？</p>
        </div>
        <div class="liar-chat__preview hidden" data-chat-preview>
          <img alt="待发送的图片">
          <div class="liar-chat__preview-body">
            <small>图片已就绪</small>
            <button class="liar-chat__unpick" type="button" data-chat-unpick>移除</button>
          </div>
        </div>
        <div class="liar-chat__composer">
          <div class="liar-chat__tools">
            <button class="liar-chat__tool" type="button" data-chat-emoji title="插入表情" aria-label="插入表情">😊</button>
            <button class="liar-chat__tool" type="button" data-chat-image title="发送图片" aria-label="发送图片">🖼️</button>
            <span class="liar-chat__hint">Enter 发送 · 图片自动压缩 · 可粘贴 / 拖入</span>
          </div>
          <div class="liar-chat__row">
            <input class="liar-chat__input" type="text" maxlength="${settings.maxText}" placeholder="说点什么…" autocomplete="off" aria-label="聊天输入">
            <button class="liar-chat__send" type="button" data-chat-send>发送</button>
          </div>
          <div class="liar-chat__picker hidden" data-chat-picker role="dialog" aria-label="选择表情"></div>
        </div>
        <input class="liar-chat__file" type="file" accept="image/*" hidden>
      </div>
    `;

    const headEl = host.querySelector('[data-chat-head]');
    const toggleEl = host.querySelector('[data-chat-toggle]');
    const badgeEl = host.querySelector('[data-chat-badge]');
    const listEl = host.querySelector('[data-chat-list]');
    const previewEl = host.querySelector('[data-chat-preview]');
    const previewImg = previewEl.querySelector('img');
    const pickerEl = host.querySelector('[data-chat-picker]');
    const inputEl = host.querySelector('.liar-chat__input');
    const sendEl = host.querySelector('[data-chat-send]');
    const fileEl = host.querySelector('.liar-chat__file');

    pickerEl.innerHTML = settings.emojis
      .map((emoji) => `<button type="button" class="liar-chat__emoji" data-chat-emoji-value="${emoji}" aria-label="表情 ${emoji}">${emoji}</button>`)
      .join('');

    function playerFor(id) {
      let found = null;
      if (typeof opts.getPlayer === 'function') {
        try { found = opts.getPlayer(id); } catch (e) { found = null; }
      }
      if (!found && C.Net && typeof C.Net.players !== 'undefined') {
        found = C.Net.players.find((p) => p.id === id) || null;
      }
      return found;
    }

    function nameFor(id) {
      if (id && id === selfId) return '你';
      const player = playerFor(id);
      return player && player.name ? player.name : '玩家';
    }

    function avatarFor(id) {
      const player = playerFor(id);
      return (player && player.avatar) || '🎭';
    }

    function applyCollapsed() {
      host.classList.toggle('is-collapsed', collapsed);
      toggleEl.textContent = collapsed ? '展开' : '收起';
      toggleEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (!collapsed) {
        unread = 0;
        updateBadge();
        scrollToBottom();
      }
    }

    function updateBadge() {
      badgeEl.textContent = unread > 9 ? '9+' : String(unread);
      badgeEl.classList.toggle('hidden', unread <= 0 || !collapsed);
    }

    function scrollToBottom() {
      requestAnimationFrame(() => {
        if (!destroyed) listEl.scrollTop = listEl.scrollHeight;
      });
    }

    function clearEmpty() {
      const empty = listEl.querySelector('.liar-chat__empty');
      if (empty) empty.remove();
    }

    function buildMessage(item) {
      if (item.kind === 'system') {
        const line = document.createElement('div');
        line.className = 'liar-chat__system';
        line.textContent = item.text;
        return line;
      }

      const mine = !!selfId && item.from === selfId;
      const wrap = document.createElement('div');
      wrap.className = 'liar-chat__msg' + (mine ? ' is-me' : '');

      const avatar = document.createElement('span');
      avatar.className = 'liar-chat__avatar';
      avatar.textContent = avatarFor(item.from) || (mine ? '🧑' : '🎭');
      avatar.setAttribute('aria-hidden', 'true');

      const main = document.createElement('div');
      main.className = 'liar-chat__main';

      const meta = document.createElement('div');
      meta.className = 'liar-chat__meta';
      meta.textContent = nameFor(item.from) + (item.at ? ' · ' + formatTime(item.at) : '');

      const bubble = document.createElement('div');
      bubble.className = 'liar-chat__bubble';
      if (item.text) {
        const text = document.createElement('div');
        text.className = 'liar-chat__text';
        text.textContent = item.text;
        bubble.appendChild(text);
      }
      if (item.image) {
        const image = document.createElement('img');
        image.className = 'liar-chat__image';
        image.src = item.image;
        image.alt = '聊天图片';
        image.loading = 'lazy';
        image.addEventListener('click', () => openLightbox(item.image));
        bubble.appendChild(image);
      }

      main.appendChild(meta);
      main.appendChild(bubble);
      if (mine) {
        wrap.appendChild(main);
        wrap.appendChild(avatar);
      } else {
        wrap.appendChild(avatar);
        wrap.appendChild(main);
      }
      return wrap;
    }

    function push(item) {
      messages.push(item);
      clearEmpty();
      listEl.appendChild(buildMessage(item));
      while (messages.length > settings.maxHistory && listEl.firstElementChild) {
        messages.shift();
        listEl.firstElementChild.remove();
      }
      if (collapsed) {
        unread += 1;
        updateBadge();
      } else {
        scrollToBottom();
      }
    }

    function receive(msg) {
      if (destroyed || !msg) return;
      const payload = msg.payload || {};
      if (msg.type === 'system') {
        const text = cleanText(payload.text, 200);
        if (!text) return;
        push({ kind: 'system', text });
        return;
      }
      if (msg.type !== 'chat') return;
      const text = cleanText(payload.text);
      const image = isSafeImage(payload.image) ? payload.image : null;
      if (!text && !image) return;
      push({ kind: 'chat', from: msg.from || '', text, image, at: msg.at || Date.now() });
    }

    function renderPreview() {
      if (!pendingImage) {
        previewEl.classList.add('hidden');
        previewImg.removeAttribute('src');
        return;
      }
      previewImg.src = pendingImage;
      previewEl.classList.remove('hidden');
    }

    function toggleEmoji(force) {
      emojiOpen = typeof force === 'boolean' ? force : !emojiOpen;
      pickerEl.classList.toggle('hidden', !emojiOpen);
      if (emojiOpen) {
        collapsed = false;
        applyCollapsed();
      }
    }

    function insertEmoji(emoji) {
      const start = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : inputEl.value.length;
      const end = typeof inputEl.selectionEnd === 'number' ? inputEl.selectionEnd : start;
      inputEl.value = inputEl.value.slice(0, start) + emoji + inputEl.value.slice(end);
      const caret = start + emoji.length;
      try { inputEl.setSelectionRange(caret, caret); } catch (e) { /* ignore */ }
      inputEl.focus();
    }

    function send() {
      if (destroyed) return;
      const text = cleanText(inputEl.value);
      const image = pendingImage;
      if (!text && !image) {
        inputEl.focus();
        return;
      }
      const now = Date.now();
      if (now - lastSentAt < settings.minIntervalMs) return;
      lastSentAt = now;

      const payload = { text, image };
      inputEl.value = '';
      pendingImage = null;
      renderPreview();
      toggleEmoji(false);

      let request = null;
      if (typeof opts.send === 'function') {
        try { request = opts.send(payload); } catch (e) { request = Promise.reject(e); }
      } else {
        request = Promise.reject(new Error('not connected'));
      }
      Promise.resolve(request).catch(() => {
        if (destroyed) return;
        if (!inputEl.value) inputEl.value = text;
        if (image && !pendingImage) {
          pendingImage = image;
          renderPreview();
        }
        C.UI.toast('消息没发出去，检查一下连接。', 'lose');
      });
    }

    function openLightbox(src) {
      if (!isSafeImage(src)) return;
      closeLightbox();
      lightbox = document.createElement('div');
      lightbox.className = 'chat-lightbox';
      lightbox.setAttribute('role', 'dialog');
      lightbox.setAttribute('aria-label', '查看聊天图片');

      const image = document.createElement('img');
      image.src = src;
      image.alt = '聊天图片';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'chat-lightbox__close';
      close.setAttribute('aria-label', '关闭图片');
      close.textContent = '×';

      lightbox.appendChild(image);
      lightbox.appendChild(close);
      lightbox.addEventListener('click', (event) => {
        if (event.target !== image) closeLightbox();
      });
      document.body.appendChild(lightbox);
    }

    function closeLightbox() {
      if (!lightbox) return;
      lightbox.remove();
      lightbox = null;
    }

    function onDocumentKey(event) {
      if (event.key !== 'Escape') return;
      if (lightbox) {
        event.preventDefault();
        event.stopPropagation();
        closeLightbox();
        return;
      }
      if (emojiOpen) {
        event.preventDefault();
        event.stopPropagation();
        toggleEmoji(false);
      }
    }

    function handleFiles(fileList) {
      const file = fileList && fileList[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        C.UI.toast('只能发送图片文件。', 'lose');
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        C.UI.toast('图片太大了（最大 12 MB）。', 'lose');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (destroyed) return;
        const image = new Image();
        image.onload = () => {
          if (destroyed) return;
          try {
            pendingImage = compressImage(image, settings);
            collapsed = false;
            applyCollapsed();
            renderPreview();
            inputEl.focus();
          } catch (error) {
            C.UI.toast(error.message || '图片处理失败。', 'lose');
          }
        };
        image.onerror = () => C.UI.toast('这张图片读不出来。', 'lose');
        image.src = String(reader.result);
      };
      reader.onerror = () => C.UI.toast('读取图片失败。', 'lose');
      reader.readAsDataURL(file);
    }

    headEl.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      collapsed = !collapsed;
      applyCollapsed();
    });

    toggleEl.addEventListener('click', () => {
      collapsed = !collapsed;
      applyCollapsed();
    });

    sendEl.addEventListener('click', send);

    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.stopPropagation();
        send();
      }
    });

    inputEl.addEventListener('input', () => {
      if (emojiOpen && !inputEl.value) toggleEmoji(false);
    });

    inputEl.addEventListener('paste', (event) => {
      const files = event.clipboardData && event.clipboardData.files;
      if (files && files.length && /^image\//.test(files[0].type)) {
        event.preventDefault();
        handleFiles(files);
      }
    });

    host.querySelector('[data-chat-emoji]').addEventListener('click', () => toggleEmoji());
    host.querySelector('[data-chat-image]').addEventListener('click', () => fileEl.click());

    pickerEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-chat-emoji-value]');
      if (!button) return;
      insertEmoji(button.dataset.chatEmojiValue);
    });

    previewEl.querySelector('[data-chat-unpick]').addEventListener('click', () => {
      pendingImage = null;
      renderPreview();
    });

    fileEl.addEventListener('change', () => {
      handleFiles(fileEl.files);
      fileEl.value = '';
    });

    host.addEventListener('dragover', (event) => {
      if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) {
        event.preventDefault();
      }
    });

    host.addEventListener('drop', (event) => {
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      event.preventDefault();
      handleFiles(files);
    });

    document.addEventListener('keydown', onDocumentKey, true);
    applyCollapsed();

    return {
      receive,
      focus() {
        collapsed = false;
        applyCollapsed();
        inputEl.focus();
      },
      get isOpen() { return !collapsed; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        document.removeEventListener('keydown', onDocumentKey, true);
        closeLightbox();
        host.innerHTML = '';
        host.classList.remove('liar-chat', 'is-collapsed');
      }
    };
  }

  C.Chat = {
    mount,
    cleanText,
    isSafeImage,
    formatTime,
    compressImage
  };
})(window.Casino = window.Casino || {});
