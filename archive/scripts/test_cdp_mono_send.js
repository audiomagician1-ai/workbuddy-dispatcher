// test_cdp_mono_send.js
// 通过 CDP 操作 Monaco 编辑器的输入框，发送消息给 AI Agent
const WebSocket = require('ws');

const wsUrl = 'ws://localhost:9222/devtools/page/7CB32DC472F037EF149A11AE2B55ED87';
const ws = new WebSocket(wsUrl);

let msgId = 0;

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

async function main() {
  ws.on('open', async () => {
    console.log('Connected to Workbench\n');

    // 先看 DOM 结构
    console.log('=== DOM 结构分析 ===');
    const r1 = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        monacoInputs: Array.from(document.querySelectorAll('textarea, .inputarea')).map(e => ({
          tag: e.tagName, class: e.className.substring(0,60), id: e.id,
          visible: e.offsetWidth > 0, rect: e.getBoundingClientRect().top + ',' + e.getBoundingClientRect().left
        })),
        allTextareas: document.querySelectorAll('textarea').length,
        editableDivs: document.querySelectorAll('[contenteditable="true"]').length
      })`,
      returnByValue: true
    });
    console.log(JSON.stringify(JSON.parse(r1.result.result.value), null, 2));

    // 找 Monaco editor 的实例
    const r2 = await send('Runtime.evaluate', {
      expression: `typeof window.monaco`,
      returnByValue: true
    });
    console.log('\nwindow.monaco:', r2.result.result.value);

    // 尝试直接操作输入框
    console.log('\n=== 尝试发送消息 ===');
    const r3 = await send('Runtime.evaluate', {
      expression: `(async () => {
        // 找输入框
        const ta = document.querySelector('textarea');
        if (!ta) return 'no textarea found';

        // 聚焦
        ta.focus();

        // 输入文字
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeInputValueSetter.call(ta, '你好，帮我写一个 hello world');
        ta.dispatchEvent(new Event('input', { bubbles: true }));

        return 'input focused and text set on textarea';
      })()`,
      returnByValue: true
    });
    console.log('DOM input result:', r3.result.result.value);

    // 截图看看
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync('mono-input.png', Buffer.from(ss.result.data, 'base64'));
    console.log('Screenshot: mono-input.png');

    ws.close();
    console.log('\nDone');
  });
}

main().catch(e => { console.error(e.message); ws.close(); });