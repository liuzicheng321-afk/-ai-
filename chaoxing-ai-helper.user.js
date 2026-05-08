// ==UserScript==
// @name         AI 答题器 (超星 V9.4 · 进度+复核)
// @namespace    https://github.com/liuzicheng321-afk
// @version      9.4
// @description  支持进度条、预估时间、AI复核答案
// @author       liuzicheng321-afk
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
    if (window.__CX_AI_V94__) return;
    window.__CX_AI_V94__ = true;

    // ==================== 样式 ====================
    GM_addStyle(`
        #cx-ai-panel {
            position: fixed; bottom: 30px; right: 30px; z-index: 2147483647;
            width: 230px; background: white; border: 2px solid #1890ff;
            border-radius: 12px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            font-family: 'Microsoft YaHei', sans-serif;
        }
        #cx-ai-panel .title { font-size:14px; font-weight:bold; color:#1890ff; text-align:center; margin-bottom:10px; }
        #cx-ai-panel button { width:100%; padding:10px; margin:5px 0; border:none; border-radius:6px; font-size:13px; font-weight:bold; cursor:pointer; color:white; transition:0.2s; }
        #cx-ai-panel button:active { transform:scale(0.95); }
        #cx-ai-panel button:disabled { background:#ccc !important; }
        .cx-btn-current { background: linear-gradient(135deg, #11998e, #38ef7d); }
        .cx-btn-auto { background: linear-gradient(135deg, #667eea, #764ba2); }
        .cx-btn-review { background: linear-gradient(135deg, #f0ad4e, #ec971f); }
        #cx-ai-progress {
            margin: 8px 0; padding: 6px; background: #f0f2f5; border-radius: 6px;
            font-size: 12px; color: #333;
        }
        #cx-ai-progress .bar {
            height: 8px; background: #52c41a; width: 0%; border-radius: 4px;
            transition: width 0.3s; margin: 4px 0;
        }
        #cx-ai-toast {
            position: fixed; top: 20%; left: 50%; transform: translate(-50%,-50%);
            background: rgba(0,0,0,0.85); color: white; padding: 12px 24px;
            border-radius: 8px; z-index: 2147483648; display: none;
            font-size: 14px; text-align: center; max-width: 80vw;
        }
        .cx-answer-tag {
            background: #fff7e6!important; border: 2px solid #ffa940!important;
            padding: 6px 12px!important; margin: 8px 0!important; border-radius: 6px!important;
            color: #ad4e00!important; font-size: 14px!important; font-weight: bold!important;
            text-align: center!important;
        }
        .cx-review-dialog {
            position: fixed; top: 5%; left: 5%; right: 5%; bottom: 5%;
            background: white; border-radius: 12px; z-index: 2147483649;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4); overflow-y: auto;
            padding: 20px; display: none; font-family: 'Microsoft YaHei', sans-serif;
        }
        .cx-review-dialog .close-btn {
            float: right; font-size: 22px; cursor: pointer; color: #999;
        }
        .review-item { margin: 12px 0; padding: 10px; border-radius: 6px; border-left: 4px solid #1890ff; }
        .review-correct { border-left-color: #52c41a; background: #f6ffed; }
        .review-uncertain { border-left-color: #faad14; background: #fffbe6; }
        .review-wrong { border-left-color: #ff4d4f; background: #fff2f0; }
    `);

    // ---------- 进度条管理 ----------
    let progressTimer = null;
    let progressStartTime = 0;
    let totalQuestions = 0;
    let completedQuestions = 0;

    function showProgress(total) {
        totalQuestions = total;
        completedQuestions = 0;
        progressStartTime = Date.now();
        const panel = document.getElementById('cx-ai-progress');
        if (panel) {
            panel.style.display = 'block';
            updateProgress(0);
        }
    }

    function updateProgress(done) {
        completedQuestions = done;
        const elapsed = (Date.now() - progressStartTime) / 1000;
        const speed = completedQuestions / Math.max(elapsed, 0.1);
        const remaining = totalQuestions - completedQuestions;
        const etaSeconds = speed > 0 ? remaining / speed : 0;
        const etaText = etaSeconds > 60 ? Math.round(etaSeconds / 60) + '分' : Math.round(etaSeconds) + '秒';
        const percent = totalQuestions > 0 ? Math.round((completedQuestions / totalQuestions) * 100) : 0;

        const bar = document.querySelector('#cx-ai-progress .bar');
        const info = document.querySelector('#cx-ai-progress .info');
        if (bar) bar.style.width = percent + '%';
        if (info) {
            info.innerHTML = `进度：${completedQuestions}/${totalQuestions} (${percent}%) <br>
                              已用：${Math.round(elapsed)}秒 | 预计剩余：${etaText}`;
        }
    }

    function hideProgress() {
        const panel = document.getElementById('cx-ai-progress');
        if (panel) panel.style.display = 'none';
        if (progressTimer) clearInterval(progressTimer);
    }

    // ---------- Toast ----------
    let toastTimer;
    function showToast(msg, duration = 3000) {
        let toast = document.getElementById('cx-ai-toast');
        if (!toast) { toast = document.createElement('div'); toast.id = 'cx-ai-toast'; document.body.appendChild(toast); }
        toast.textContent = msg; toast.style.display = 'block';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.style.display = 'none'; }, duration);
    }

    // ---------- 选项提取 ----------
    function extractOptions(container, qid) {
        const optionDivs = container.querySelectorAll('div.answerBg[aria-label], div.answerBg');
        const options = [];
        optionDivs.forEach(optDiv => {
            let letter = '', text = '';
            const ariaLabel = optDiv.getAttribute('aria-label');
            if (ariaLabel) {
                const match = ariaLabel.match(/^([A-Z])\s*(.+?)(选择)?$/);
                if (match) { letter = match[1]; text = match[2].trim(); }
            }
            if (!letter) {
                const inner = optDiv.textContent.trim();
                const m = inner.match(/^([A-Z])[\.\、\s]*(.+)/);
                if (m) { letter = m[1]; text = m[2].trim(); }
                else { letter = '?'; text = inner; }
            }
            options.push({ letter, text, div: optDiv, qid });
        });
        return options;
    }

    // ---------- 扫描题目 ----------
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

    // ---------- 点击选项（兼容多选）----------
    function selectOption(option) {
        if (!option || !option.div) return false;
        const div = option.div;
        if (typeof div.onclick === 'function') div.onclick();
        div.click();
        div.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        div.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true }));
        const role = div.getAttribute('role');
        if (role === 'checkbox') {
            div.setAttribute('aria-checked', 'true');
            div.setAttribute('aria-pressed', 'true');
        } else if (role === 'radio') {
            const qid = div.getAttribute('qid');
            if (qid) {
                document.querySelectorAll(`div.answerBg[qid="${qid}"]`).forEach(s => {
                    s.setAttribute('aria-checked', 'false');
                    s.setAttribute('aria-pressed', 'false');
                });
            }
            div.setAttribute('aria-checked', 'true');
            div.setAttribute('aria-pressed', 'true');
        }
        return true;
    }

    // ---------- 下一题按钮 ----------
    function findNextButton() {
        const all = document.querySelectorAll('a, button, span, div');
        for (const el of all) {
            if (el.offsetParent === null) continue;
            if (el.textContent.replace(/\s/g, '').includes('下一题')) return el;
        }
        return document.querySelector('.nextDiv, .next_ul, .nextBtn');
    }

    // ---------- 调用 AI 获取答案 ----------
    async function getAnswersFromAI(questions) {
        const apiKey = GM_getValue('cx_ai_key', '');
        if (!apiKey) {
            const key = prompt('请输入 DeepSeek API Key：\n获取地址：https://platform.deepseek.com/api_keys');
            if (!key?.trim()) throw new Error('未设置API Key');
            GM_setValue('cx_ai_key', key.trim());
        }
        const prompt = `你是考试答题专家。返回纯JSON：{"题目ID":"答案字母"}。单选题单个字母，多选题多个字母连在一起，判断题A=正确 B=错误。只输出JSON。`;
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

    // ==================== 答案复核 ====================
    async function reviewAnswers(questions, answers) {
        const apiKey = GM_getValue('cx_ai_key', '');
        if (!apiKey) throw new Error('无API Key');
        const prompt = `你是一位严谨的审题专家。我会提供题目、选项以及已选择的答案，请你判断每个答案是否正确，并给出简短的解释（1-2句话）。返回JSON格式：
{
  "题目ID": {
    "correct": true或false,
    "explanation": "解释"
  }
}`;
        const data = questions.map(q => ({
            id: q.id,
            title: q.title,
            options: q.options.map(o => o.letter + '. ' + o.text),
            chosen: answers[q.id] || '无'
        }));
        const resp = await GM.xmlHttpRequest({
            method: 'POST', url: 'https://api.deepseek.com/chat/completions',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
            data: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role:'system', content:prompt },
                    { role:'user', content: JSON.stringify(data) }
                ],
                response_format: { type:'json_object' }, temperature:0.3, max_tokens:4096
            }), timeout:60000
        });
        const content = JSON.parse(resp.responseText).choices[0].message.content;
        let review;
        try { review = JSON.parse(content); } catch { review = JSON.parse(content.match(/\{[\s\S]*\}/)[0]); }
        return review;
    }

    function showReviewDialog(questions, answers, review) {
        // 移除旧对话框
        const old = document.getElementById('cx-review-dialog');
        if (old) old.remove();

        const dialog = document.createElement('div');
        dialog.id = 'cx-review-dialog';
        dialog.className = 'cx-review-dialog';
        let html = '<span class="close-btn" onclick="this.parentElement.remove()">✕</span><h2>🔍 AI 答案复核</h2>';
        questions.forEach(q => {
            const r = review[q.id];
            if (!r) return;
            const statusClass = r.correct ? 'review-correct' : 'review-uncertain';
            const statusIcon = r.correct ? '✅' : '⚠️';
            html += `<div class="review-item ${statusClass}">
                <strong>${q.id} [${q.type}]</strong> ${q.title.substring(0, 40)}...<br>
                🤖 选择：${answers[q.id] || '无'}　${statusIcon} ${r.correct ? '正确' : '可能有问题'}<br>
                💬 解释：${r.explanation}
            </div>`;
        });
        dialog.innerHTML = html;
        document.body.appendChild(dialog);
        dialog.style.display = 'block';
    }

    // ---------- 作答当前页（含进度）----------
    async function answerCurrentPage() {
        const btn = document.getElementById('cx-btn-current');
        btn.disabled = true; btn.textContent = '⏳ AI分析中...';

        const questions = scanAllQuestions();
        if (!questions.length) {
            showToast('❌ 当前页无题目');
            btn.disabled = false; btn.textContent = '✅ 作答当前页';
            return;
        }

        try {
            // 获取答案（不更新进度，因为AI请求是一次性的）
            showToast(`正在请求AI解答 ${questions.length} 题...`);
            const answers = await getAnswersFromAI(questions);

            // 显示进度条，然后逐题填入
            showProgress(questions.length);
            let done = 0;
            for (const q of questions) {
                const ans = answers[q.id];
                if (!ans) continue;
                const tag = document.createElement('div');
                tag.className = 'cx-answer-tag';
                tag.textContent = `🤖 AI推荐：${ans}`;
                q.container.insertBefore(tag, q.container.firstChild);

                const letters = ans.match(/[A-D]/g) || [];
                letters.forEach(l => {
                    const opt = q.options.find(o => o.letter === l);
                    if (opt) selectOption(opt);
                });

                done++;
                updateProgress(done);
                // 模拟操作间隔
                await new Promise(r => setTimeout(r, 100));
            }

            hideProgress();
            showToast(`✅ 已作答 ${done}/${questions.length} 题`);

            // 保存最近的答题数据用于复核
            window.__CX_LAST_QA__ = { questions, answers };

            // 显示复核按钮（如果还没显示）
            let reviewBtn = document.getElementById('cx-btn-review');
            if (!reviewBtn) {
                reviewBtn = document.createElement('button');
                reviewBtn.id = 'cx-btn-review';
                reviewBtn.className = 'cx-btn-review';
                reviewBtn.textContent = '🔍 复核答案';
                reviewBtn.onclick = async () => {
                    if (!window.__CX_LAST_QA__) return;
                    const { questions, answers } = window.__CX_LAST_QA__;
                    try {
                        showToast('AI正在复核...');
                        const review = await reviewAnswers(questions, answers);
                        showReviewDialog(questions, answers, review);
                        showToast('复核完成');
                    } catch (e) { showToast('❌ 复核失败：' + e.message); }
                };
                document.getElementById('cx-ai-panel').appendChild(reviewBtn);
            }

        } catch (e) {
            hideProgress();
            showToast(`❌ 错误：${e.message}`);
        }
        btn.disabled = false; btn.textContent = '✅ 作答当前页';
    }

    // ---------- UI ----------
    function createUI() {
        if (document.getElementById('cx-ai-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'cx-ai-panel';
        panel.innerHTML = `
            <div class="title">🤖 超星AI答题器 V9.4</div>
            <button id="cx-btn-current" class="cx-btn-current">✅ 作答当前页</button>
            <div id="cx-ai-progress" style="display:none;">
                <div class="info"></div>
                <div class="bar"></div>
            </div>
            <button id="cx-btn-next" class="cx-btn-next">➡️ 下一题</button>
            <div style="text-align:center;margin-top:10px;font-size:11px;">
                <a href="#" id="cx-set-key" style="color:#999;">🔑 设置Key</a>
                <span style="color:#ccc;"> | </span>
                <a href="#" id="cx-scan-test" style="color:#999;">🔍 扫描测试</a>
            </div>
        `;
        document.body.appendChild(panel);
        document.getElementById('cx-btn-current').onclick = answerCurrentPage;
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
            qs.forEach(q => msg += `${q.id}[${q.type}] ${q.title.slice(0,30)}...\n`);
            alert(msg);
        };
        showToast('✅ V9.4 已启动');
    }

    if (document.body) createUI();
    else document.addEventListener('DOMContentLoaded', createUI);
    setInterval(() => { if (!document.getElementById('cx-ai-panel')) createUI(); }, 5000);
})();
