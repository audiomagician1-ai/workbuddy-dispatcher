// test_cdp_analyze_send.js - 分析 Agent Manager 发送机制
const WebSocket = require('ws');

const TARGET_ID = 'E073C461311BC253D8EFC077103C3EC4';
const wsUrl = `ws://localhost:9222/devtools/page/${TARGET_ID}`;
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = {};

function send(method, params, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => { delete pending[id]; reject(new Error('timeout')); }, timeout);
    pending[id] = { resolve, timer };
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending[msg.id]) {
    clearTimeout(pending[msg.id].timer);
    pending[msg.id].resolve(msg);
    delete pending[msg.id];
  }
});

ws.on('open', async () => {
  console.log('Connected to Agent Manager\n');
  await send('Runtime.enable');

  // 1. 分析输入框的完整 DOM 结构
  const r1 = await send('Runtime.evaluate', {
    expression: `(function() {
      const editable = document.querySelector('[contenteditable="true"]');
      if (!editable) return 'no editable';
      
      // 向上遍历找表单容器
      function getAncestors(el, maxDepth) {
        const result = [];
        let current = el;
        for (let i = 0; i < maxDepth && current; i++) {
          result.push({
            tag: current.tagName,
            id: current.id || '',
            class: current.className.substring(0, 80),
            role: current.getAttribute('role') || '',
            childCount: current.children.length
          });
          current = current.parentElement;
        }
        return result;
      }

      // 找所有按钮（包括 svg 图标按钮）
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"], svg[aria-label]')).map(b => ({
        tag: b.tagName,
        text: b.textContent.trim().substring(0, 20),
        ariaLabel: b.getAttribute('aria-label') || '',
        class: b.className.substring(0, 60),
        visible: b.offsetWidth > 0,
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true'
      }));

      // 找输入框区域的兄弟元素
      const siblings = editable.parentElement ? Array.from(editable.parentElement.children).map(c => ({
        tag: c.tagName,
        class: c.className.substring(0, 50),
        text: c.textContent.trim().substring(0, 20)
      })) : [];

      return JSON.stringify({
        editableInfo: {
          tag: editable.tagName,
          class: editable.className,
          ariaLabel: editable.getAttribute('aria-label') || '',
          placeholder: editable.getAttribute('placeholder') || '',
          role: editable.getAttribute('role') || '',
          dataAttrs: Array.from(editable.attributes).filter(a => a.name.startsWith('data-')).map(a => a.name + '=' + a.value)
        },
        ancestors: getAncestors(editable, 5),
        siblings,
        visibleButtons: allButtons.filter(b => b.visible),
        allButtonsCount: allButtons.length
      }, null, 2);
    })()`
  });
  console.log('DOM Analysis:\n', r1.result?.result?.value);

  // 2. 找发送/提交相关的 keydown 事件监听
  const r2 = await send('Runtime.evaluate', {
    expression: `(function() {
      // 检查 React/Vue 事件
      const editable = document.querySelector('[contenteditable="true"]');
      if (!editable) return 'no editable';
      
      // 找 React fiber
      const reactKey = Object.keys(editable).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      
      // 检查是否有 onKeyDown
      const onKeyDown = editable.onkeydown !== null;
      
      // 检查 Enter 发送逻辑 - 查找相关 JS
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src || 'inline');
      
      return JSON.stringify({
        hasReact: !!reactKey,
        reactKey: reactKey || '',
        hasOnKeyDown: onKeyDown,
        scriptCount: scripts.length,
        // 找 form 元素
        forms: document.querySelectorAll('form').length,
        // 找 submit 类按钮
        submitButtons: Array.from(document.querySelectorAll('[type="submit"], [class*="submit"], [class*="send"]')).map(b => ({
          tag: b.tagName,
          class: b.className.substring(0, 40),
          visible: b.offsetWidth > 0
        }))
      });
    })()`
  });
  console.log('\nEvent Analysis:\n', r2.result?.result?.value);

  ws.close();
  console.log('\nDone');
});

ws.on('error', (e) => console.error('WS Error:', e.message));
