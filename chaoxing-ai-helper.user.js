// ==UserScript==
// @name         AI 答题器 (超星学习通 )
// @namespace    https://github.com/liuzicheng321-afk
// @version      9.3
// @description  1
// @author      liu
// @match        *://*.chaoxing.com/*
// @all_frames   true
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @connect      api.deepseek.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';
    if (window.__CX_AI_HELPER_V93__) return;
    window.__CX_AI_HELPER_V93__ = true;

    // ==================== 样式 ====================
    GM_addStyle(`
        #cx-ai-panel {
            position: fixed; bottom: 30px; right: 30px; z-index: 2147483647;
            width: 220px; background: white; border: 2px solid #1890ff;
            border-radius: 12px; padding: 15px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            font-family: 'Microsoft YaHei', sans-serif;
        }
        #cx-ai-panel .title { font-size:14px; font-weight:bold; color:#1890ff; text-align:center; margin-bottom:12px; }
        #cx-ai-panel button { width:100%; padding:10px; margin:5px 0; border:none; border-radius:6px; font-size:13px; font-weight:bold; cursor:pointer; color:white; transition:0.2s; }
        #cx-ai-panel button:active { transform:scale(0.95); }
        #cx-ai-panel button:disabled { background:#ccc !important; }
        .cx-btn-current { background: linear-gradient(135deg, #11998e, #38ef7d); }
        .cx-btn-auto { background: linear-gradient(135deg, #667eea, #764ba2); }
        .cx-btn-next { background: linear-gradient(135deg, #f093fb, #f5576c); }
        #cx-ai-toast { position:fixed; top:20%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.85); color:white; padding:12px 24px; border-radius:8px; z-index:2147483648; display:none; font-size:14px; text-align:center; max-width:80vw; }
        .cx-answer-tag { background:#fff7e6!important; border:2px solid #ffa940!important; padding:6px 12px!important; margin:8px 0!important; border-radius:6px!important; color:#ad4e00!important; font-size:14px!important; font-weight:bold!important; text-align:center!important; }
    `);

    // Toast
    let toastTimer;
    function showToast(msg, duration = 3000) {
        let toast = document.getElementById('cx-ai-toast');
        if (!toast) { toast = document.createElement('div'); toast.id = 'cx-ai-toast'; document.body.appendChild(toast); }
        toast.textContent = msg; toast.style.display = 'block';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.style.display = 'none'; }, duration);
    }

    // ==================== 提取选项（修正正则） ====================
    function extractOptions(container, qid) {
        const optionDivs = container.querySelectorAll('div.answerBg[aria-label], div.answerBg');
        const options = [];
        optionDivs.forEach(optDiv => {
            let letter = '', text = '';
            const ariaLabel = optDiv.getAttribute('aria-label');
            if (ariaLabel) {
                const match = ariaLabel.match(/^([A-Z])\s*(.+?)(选择)?$/);
                if (match) {
                    letter = match[1];
                    text = match[2].trim();
                }
            }
            if (!letter) {
                const inner = optDiv.textContent.trim();
                const m = inner.match(/^([A-Z])[\.\、\s]*(.+)/);
                if (m) { letter = m[1]; text = m[2].trim(); }
                else { letter = '?'; text = inner; }
            }
            // 保存 onclick 函数名（备用）
            const onclickAttr = optDiv.getAttribute('onclick');
            let clickFuncName = null;
            if (onclickAttr) {
                const fm = onclickAttr.match(/(\w+)\(/);
                if (fm) clickFuncName = fm[1];
            }
            options.push({ letter, text, div: optDiv, clickFuncName, qid });
        });
        return options;
    }

    // ==================== 扫描所有题目 ====================
    function scanAllQuestions() {
        const questionDivs = document.querySelectorAll('div.questionLi');
        const questions = [];
        questionDivs.forEach((qDiv, index) => {
            const titleEl = qDiv.querySelector('h3.mark_name');
            if (!titleEl) return;
            const title = titleEl.textContent.replace(/\s+/g, ' ').trim();
            if (!title) return;
            const qid = qDiv.id.replace('question', '');
            const typeName = qDiv.getAttribute('typename') || '';
            const options = extractOptions(qDiv, qid);
            if (options.length >= 2) {
                let type = '单选';
                if (typeName.includes('多选')) type = '多选';
                else if (typeName.includes('判断')) type = '判断';
                questions.push({
                    id: 'Q' + (index + 1),
                    qid,
                    title,
                    options,
                    container: qDiv,
                    type
                });
            }
        });
        return questions;
    }

    // ==================== 点击选项（终极版） ====================
    function selectOption(option) {
        if (!option || !option.div) return false;
        const div = option.div;

        // 1. 直接调用超星绑定的 onclick 函数（最可靠）
        if (typeof div.onclick === 'function') {
            div.onclick();
        } else if (option.clickFuncName && typeof window[option.clickFuncName] === 'function') {
            window[option.clickFuncName](div);
        } else if (typeof addChoice === 'function') {
            addChoice(div);
        } else if (typeof addMultipleChoice === 'function') {
            addMultipleChoice(div);
        }

        // 2. 模拟完整的点击和键盘事件
        div.click();
        div.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        div.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true
        }));

        // 3. 手动修改 aria-checked 状态（视觉反馈）
        const role = div.getAttribute('role');
        if (role === 'checkbox') {
            div.setAttribute('aria-checked', 'true');
            div.setAttribute('aria-pressed', 'true');
        } else if (role === 'radio') {
            // 单选：取消同组其他选项
            const qid = div.getAttribute('qid');
            if (qid) {
                document.querySelectorAll(`div.answerBg[qid="${qid}"]`).forEach(sibling => {
                    sibling.setAttribute('aria-checked', 'false');
                    sibling.setAttribute('aria-pressed', 'false');
                    sibling.classList.remove('cx-selected');
                });
            }
            div.setAttribute('aria-checked', 'true');
            div.setAttribute('aria-pressed', 'true');
        }
        div.classList.add('cx-selected');
        return true;
    }

    // 查找下一题按钮
    function findNextButton() {
        const all = document.querySelectorAll('a, button, span, div');
        for (const el of all) {
            if (el.offsetParent === null) continue;
            if (el.textContent.replace(/\s/g, '').includes('下一题')) return el;
        }
        return document.querySelector('.nextDiv, .next_ul, .nextBtn');
    }

    // ==================== 调用 AI ====================
    async function getAnswersFromAI(questions) {
        const apiKey = GM_getValue('cx_ai_key', '');
        if (!apiKey) {
            const key = prompt('请输入 DeepSeek API Key：\n获取地址：https://platform.deepseek.com/api_keys');
            if (!key?.trim()) throw new Error('未设置API Key');
            GM_setValue('cx_ai_key', key.trim());
        }
        const prompt = `你是考试答题专家。返回纯JSON：{"题目ID":"答案字母"}。单选题单个字母，多选题多个字母连一起，判断题A=正确 B=错误。只输出JSON。`;
        const reqData = questions.map(q => ({
            id: q.id, type: q.type, title: q.title,
            options: q.options.map(o => o.letter + '. ' + o.text)
        }));
        const resp = await GM.xmlHttpRequest({
            method: 'POST', url: 'https://api.deepseek.com/chat/completions',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
            data: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role:'system', content:prompt }, { role:'user', content:JSON.stringify(reqData) }],
                response_format: { type:'json_object' }, temperature:0.1, max_tokens:4096
            }), timeout:60000
        });
        const content = JSON.parse(resp.responseText).choices[0].message.content;
        let answers;
        try { answers = JSON.parse(content); } catch { answers = JSON.parse(content.match(/\{[\s\S]*\}/)[0]); }
        return answers;
    }

    // ==================== 作答当前页 ====================
    async function answerCurrentPage() {
        const btn = document.getElementById('cx-btn-current');
        btn.disabled = true; btn.textContent = '⏳ AI分析中...';
        const questions = scanAllQuestions();
        if (!questions.length) { showToast('❌ 当前页无题目'); btn.disabled = false; btn.textContent='✅ 作答当前页'; return; }
        try {
            const answers = await getAnswersFromAI(questions);
            let done = 0;
            for (const q of questions) {
                const ans = answers[q.id];
                if (!ans) continue;
                // 添加答案标签
                const tag = document.createElement('div');
                tag.className = 'cx-answer-tag';
                tag.textContent = `🤖 AI推荐：${ans}`;
                q.container.insertBefore(tag, q.container.firstChild);
                // 提取答案字母并逐个点击
                const letters = ans.match(/[A-D]/g) || [];
                letters.forEach(l => {
                    const opt = q.options.find(o => o.letter === l);
                    if (opt) {
                        const ok = selectOption(opt);
                        console.log(`点击选项 ${l} (${q.type}): ${ok ? '成功' : '失败'}`);
                    }
                });
                done++;
            }
            showToast(`✅ 已作答 ${done}/${questions.length} 题`);
        } catch(e) { showToast(`❌ ${e.message}`); }
        btn.disabled = false; btn.textContent = '✅ 作答当前页';
    }

    // ==================== UI ====================
    function createUI() {
        if (document.getElementById('cx-ai-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'cx-ai-panel';
        panel.innerHTML = `
            <div class="title">🤖 超星AI答题器 V9.3</div>
            <button id="cx-btn-current" class="cx-btn-current">✅ 作答当前页</button>
            <button id="cx-btn-auto" class="cx-btn-auto">🤖 全自动答题</button>
            <button id="cx-btn-next" class="cx-btn-next">➡️ 下一题</button>
            <div style="text-align:center;margin-top:10px;font-size:11px;">
                <a href="#" id="cx-set-key" style="color:#999;">🔑 设置Key</a>
                <span style="color:#ccc;"> | </span>
                <a href="#" id="cx-scan-test" style="color:#999;">🔍 扫描测试</a>
            </div>
        `;
        document.body.appendChild(panel);
        document.getElementById('cx-btn-current').onclick = answerCurrentPage;
        document.getElementById('cx-btn-auto').onclick = () => alert('全自动模式开发中，暂用当前页作答');
        document.getElementById('cx-btn-next').onclick = () => {
            const nxt = findNextButton();
            if (nxt) nxt.click(); else showToast('未找到下一题');
        };
        document.getElementById('cx-set-key').onclick = (e) => {
            e.preventDefault();
            const key = prompt('API Key:', GM_getValue('cx_ai_key',''));
            if (key?.trim()) { GM_setValue('cx_ai_key', key.trim()); showToast('✅ Key已保存'); }
        };
        document.getElementById('cx-scan-test').onclick = (e) => {
            e.preventDefault();
            const qs = scanAllQuestions();
            let msg = `识别到 ${qs.length} 题：\n`;
            qs.forEach(q => msg += `${q.id}[${q.type}] ${q.title.slice(0,30)}...\n选项：${q.options.map(o=>o.letter).join(' ')}\n`);
            alert(msg);
        };
        showToast('✅ V9.3 已启动');
    }

    if (document.body) createUI();
    else document.addEventListener('DOMContentLoaded', createUI);
    setInterval(() => { if (!document.getElementById('cx-ai-panel')) createUI(); }, 5000);
})();
