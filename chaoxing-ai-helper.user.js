// ==UserScript==
// @name         超星AI学习助手
// @namespace    https://github.com/liuzicheng321-afk
// @version      10.0.0
// @description  智能识别题目类型，支持单选题/多选题/判断题，附带进度提示和答案复核
// @author       Liu
// @match        *://*.chaoxing.com/*
// @all_frames   true
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.deepseek.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 基础配置 ====================
    const APP = {
        name: '超星AI助手',
        version: '10.0.0',
        debug: true,
        api: {
            url: 'https://api.deepseek.com/chat/completions',
            model: 'deepseek-chat',
            maxTokens: 4096,
            temp: 0.1,
            timeout: 60000
        }
    };

    // 防止重复加载
    if (window.__MY_AI_HELPER_LOADED__) return;
    window.__MY_AI_HELPER_LOADED__ = true;

    // ==================== 工具函数 ====================
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    function log(tag, msg, data) {
        if (!APP.debug) return;
        const style = {
            info: 'color: #1890ff',
            ok: 'color: #52c41a',
            err: 'color: #ff4d4f',
            warn: 'color: #faad14'
        };
        console.log(`%c[${APP.name}] ${msg}`, style[tag] || '', data || '');
    }

    // Toast 提示
    let toastTimer;
    function toast(msg, time = 3000) {
        let el = document.getElementById('my-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'my-toast';
            el.style.cssText = `
                position:fixed;top:20px;left:50%;transform:translateX(-50%);
                background:rgba(0,0,0,0.8);color:#fff;padding:10px 24px;
                border-radius:8px;z-index:999999;font-size:14px;
                pointer-events:none;white-space:nowrap;
            `;
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.style.display = 'none', time);
    }

    // ==================== 样式注入 ====================
    function injectStyles() {
        if ($('#my-ai-styles')) return;
        const css = `
            #my-ai-panel {
                position:fixed;bottom:30px;right:30px;z-index:999999;
                width:240px;background:#fff;border-radius:16px;
                box-shadow:0 8px 32px rgba(0,0,0,0.2);overflow:hidden;
                font-family:'Microsoft YaHei',sans-serif;font-size:13px;
            }
            #my-ai-panel .head {
                background:linear-gradient(135deg,#667eea,#764ba2);
                color:#fff;padding:14px 16px;font-weight:700;font-size:15px;
                text-align:center;letter-spacing:1px;
            }
            #my-ai-panel .body { padding:12px 16px; }
            #my-ai-panel button {
                display:block;width:100%;padding:10px;margin:6px 0;
                border:none;border-radius:8px;font-size:13px;font-weight:600;
                cursor:pointer;color:#fff;transition:all 0.2s;
            }
            #my-ai-panel button:hover { opacity:0.9;transform:translateY(-1px); }
            #my-ai-panel button:active { transform:scale(0.97); }
            #my-ai-panel button:disabled { background:#bbb!important;cursor:not-allowed;transform:none; }
            .btn-answer { background:linear-gradient(135deg,#11998e,#38ef7d); }
            .btn-review { background:linear-gradient(135deg,#f0ad4e,#ec971f); }
            .btn-next   { background:linear-gradient(135deg,#f093fb,#f5576c); }
            .btn-config { background:transparent;color:#999!important;font-size:11px!important;padding:4px!important;text-decoration:underline; }
            #my-progress {
                display:none;margin:8px 0;padding:8px;background:#f5f5f5;
                border-radius:8px;font-size:11px;color:#666;
            }
            #my-progress .bar-track {
                height:6px;background:#e0e0e0;border-radius:3px;margin-top:4px;overflow:hidden;
            }
            #my-progress .bar-fill {
                height:100%;background:linear-gradient(90deg,#52c41a,#73d13d);
                width:0%;border-radius:3px;transition:width 0.3s;
            }
            .my-answer-tag {
                background:#fffbe6!important;border-left:4px solid #faad14!important;
                padding:8px 12px!important;margin:6px 0!important;
                border-radius:4px!important;font-weight:600!important;
                font-size:13px!important;color:#ad4e00!important;
            }
            #my-review-modal {
                position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                width:650px;max-height:80vh;background:#fff;border-radius:16px;
                z-index:9999999;box-shadow:0 16px 64px rgba(0,0,0,0.4);
                overflow-y:auto;padding:24px;display:none;
            }
            #my-review-modal .modal-close {
                float:right;font-size:24px;cursor:pointer;color:#999;line-height:1;
            }
            #my-review-modal .review-card {
                padding:10px 14px;margin:8px 0;border-radius:8px;
                border-left:5px solid #1890ff;font-size:13px;
            }
            .review-card.ok  { border-left-color:#52c41a;background:#f6ffed; }
            .review-card.maybe { border-left-color:#faad14;background:#fffbe6; }
        `;
        GM_addStyle(css);
        const tag = document.createElement('style');
        tag.id = 'my-ai-styles';
        tag.textContent = css;
        document.head.appendChild(tag);
    }

    // ==================== 题目扫描引擎 ====================
    class QuestionScanner {
        /**
         * 扫描页面所有题目
         * @returns {Array} 题目列表
         */
        static scan() {
            const containers = $$('div.questionLi');
            const questions = [];

            containers.forEach((el, i) => {
                const titleEl = $('h3.mark_name', el);
                if (!titleEl) return;

                const title = titleEl.textContent.replace(/\s+/g, ' ').trim();
                if (!title) return;

                const qid = el.id.replace('question', '');
                const typeStr = el.getAttribute('typename') || '';
                const options = this.parseOptions(el, qid);

                if (options.length < 2) return;

                let type = '单选';
                if (typeStr.includes('多选')) type = '多选';
                else if (typeStr.includes('判断')) type = '判断';

                questions.push({ id: `Q${i + 1}`, qid, title, type, options, container: el });
            });

            log('ok', `识别到 ${questions.length} 道题目`);
            questions.forEach(q => log('info', `  ${q.id} [${q.type}] ${q.title.slice(0, 40)}...`));
            return questions;
        }

        /**
         * 解析选项
         * @private
         */
        static parseOptions(container, qid) {
            const divs = $$('div.answerBg[aria-label]', container);
            if (divs.length === 0) {
                // 备用方案：查找所有 answerBg
                return $$('div.answerBg', container).map((d, i) => ({
                    letter: String.fromCharCode(65 + i),
                    text: d.textContent.trim(),
                    div: d,
                    clickFunc: null,
                    qid
                }));
            }

            return divs.map(d => {
                const aria = d.getAttribute('aria-label') || '';
                const m = aria.match(/^([A-Z])\s*(.+?)(选择)?$/);
                const letter = m ? m[1] : String.fromCharCode(65 + i);
                const text = m ? m[2].trim() : d.textContent.trim();
                const onclick = d.getAttribute('onclick') || '';
                const fnMatch = onclick.match(/(\w+)\(/);
                return { letter, text, div: d, clickFunc: fnMatch ? fnMatch[1] : null, qid };
            });
        }
    }

    // ==================== 选项点击器 ====================
    class OptionClicker {
        /**
         * 选中一个选项
         * @param {Object} opt 选项对象
         */
        static select(opt) {
            if (!opt || !opt.div) return false;

            const el = opt.div;

            // 1. 尝试调用页面绑定的函数
            const funcName = opt.clickFunc;
            if (funcName && typeof window[funcName] === 'function') {
                window[funcName](el);
            }

            // 2. 触发点击和键盘事件
            el.click();
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
            }));

            // 3. 更新 ARIA 状态
            const role = el.getAttribute('role');
            const qid = el.getAttribute('qid');

            if (role === 'checkbox') {
                el.setAttribute('aria-checked', 'true');
                el.setAttribute('aria-pressed', 'true');
            } else if (role === 'radio' && qid) {
                $$(`div.answerBg[qid="${qid}"]`).forEach(s => {
                    s.setAttribute('aria-checked', 'false');
                    s.setAttribute('aria-pressed', 'false');
                });
                el.setAttribute('aria-checked', 'true');
                el.setAttribute('aria-pressed', 'true');
            }

            return true;
        }
    }

    // ==================== AI 客户端 ====================
    class AIClient {
        /**
         * @param {string} apiKey
         */
        constructor(apiKey) {
            this.apiKey = apiKey;
        }

        /**
         * 获取答案
         * @param {Array} questions
         * @returns {Promise<Object>}
         */
        async fetchAnswers(questions) {
            const prompt = `你是专业答题助手。请根据题目和选项返回正确答案。
格式：{"题目ID":"答案字母"}。
规则：单选题一个字母，多选题字母连在一起，判断题A=正确、B=错误。
只返回JSON对象，不要解释。`;

            const data = questions.map(q => ({
                id: q.id,
                type: q.type,
                title: q.title,
                options: q.options.map(o => `${o.letter}. ${o.text}`)
            }));

            const resp = await this._request(prompt, JSON.stringify(data, null, 2));
            return this._parseJSON(resp);
        }

        /**
         * 复核答案
         * @param {Array} questions
         * @param {Object} answers
         * @returns {Promise<Object>}
         */
        async reviewAnswers(questions, answers) {
            const prompt = `你是审题专家。我会给出题目、选项和已选答案。
请判断每个答案是否正确，并给出简短解释。
返回格式：{"题目ID":{"correct":true/false,"explanation":"解释"}}。只返回JSON。`;

            const data = questions.map(q => ({
                id: q.id,
                title: q.title,
                options: q.options.map(o => `${o.letter}. ${o.text}`),
                chosen: answers[q.id] || '未作答'
            }));

            const resp = await this._request(prompt, JSON.stringify(data, null, 2));
            return this._parseJSON(resp);
        }

        async _request(systemPrompt, userContent) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: APP.api.url,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    data: JSON.stringify({
                        model: APP.api.model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userContent }
                        ],
                        response_format: { type: 'json_object' },
                        temperature: APP.api.temp,
                        max_tokens: APP.api.maxTokens
                    }),
                    timeout: APP.api.timeout,
                    onload: (r) => {
                        try {
                            const obj = JSON.parse(r.responseText);
                            resolve(obj.choices[0].message.content);
                        } catch (e) {
                            reject(new Error('响应解析失败'));
                        }
                    },
                    onerror: () => reject(new Error('网络请求失败')),
                    ontimeout: () => reject(new Error('请求超时'))
                });
            });
        }

        _parseJSON(raw) {
            try {
                return JSON.parse(raw);
            } catch {
                const match = raw.match(/\{[\s\S]*\}/);
                if (match) return JSON.parse(match[0]);
                throw new Error('JSON解析失败: ' + raw.slice(0, 100));
            }
        }
    }

    // ==================== 进度管理器 ====================
    class ProgressManager {
        constructor() {
            this.total = 0;
            this.done = 0;
            this.startTime = 0;
        }

        start(total) {
            this.total = total;
            this.done = 0;
            this.startTime = Date.now();
            const el = $('#my-progress');
            if (el) el.style.display = 'block';
            this.update();
        }

        update(done) {
            if (done !== undefined) this.done = done;
            const elapsed = (Date.now() - this.startTime) / 1000;
            const speed = this.done / Math.max(elapsed, 0.1);
            const remaining = this.total - this.done;
            const eta = speed > 0 ? Math.round(remaining / speed) : 0;
            const pct = Math.round((this.done / this.total) * 100);

            const infoEl = $('#my-progress .info');
            const barEl = $('#my-progress .bar-fill');
            if (infoEl) infoEl.textContent = `${this.done}/${this.total} 已用${Math.round(elapsed)}秒 剩余约${eta}秒`;
            if (barEl) barEl.style.width = pct + '%';
        }

        hide() {
            const el = $('#my-progress');
            if (el) el.style.display = 'none';
        }
    }

    // ==================== 下一题查找 ====================
    function findNextButton() {
        const candidates = $$('a, button, span, div');
        for (const el of candidates) {
            if (!el.offsetParent) continue;
            if (el.textContent.replace(/\s/g, '').includes('下一题')) return el;
        }
        return $('.nextDiv, .next_ul, .nextBtn, #prevNextFocusNext');
    }

    // ==================== 答题主流程 ====================
    let progressMgr = new ProgressManager();
    let lastQAData = null; // 缓存最近一次答题数据，用于复核

    async function doAnswer() {
        const btn = $('#my-btn-answer');
        btn.disabled = true;
        btn.textContent = '正在扫描...';

        const questions = QuestionScanner.scan();
        if (questions.length === 0) {
            toast('❌ 当前页面没有找到题目');
            btn.disabled = false;
            btn.textContent = '✅ 智能作答';
            return;
        }

        // 检查 API Key
        const storedKey = GM_getValue('my_ai_key', '');
        if (!storedKey || storedKey.length < 10) {
            const input = prompt('🔑 请输入 DeepSeek API Key：\n(获取地址: https://platform.deepseek.com/api_keys)');
            if (!input || !input.trim()) {
                toast('❌ 需要 API Key 才能使用');
                btn.disabled = false;
                btn.textContent = '✅ 智能作答';
                return;
            }
            GM_setValue('my_ai_key', input.trim());
        }

        const apiKey = GM_getValue('my_ai_key', '');
        const ai = new AIClient(apiKey);

        try {
            btn.textContent = '🤖 AI分析中...';
            const answers = await ai.fetchAnswers(questions);

            // 开始填入
            progressMgr.start(questions.length);
            let done = 0;
            for (const q of questions) {
                const ans = answers[q.id];
                if (!ans) { progressMgr.update(++done); continue; }

                // 插入提示标签
                const tag = document.createElement('div');
                tag.className = 'my-answer-tag';
                tag.textContent = `🤖 AI推荐：${ans}`;
                q.container.insertBefore(tag, q.container.firstChild);

                // 点击选项
                const letters = ans.match(/[A-D]/g) || [];
                letters.forEach(l => {
                    const opt = q.options.find(o => o.letter === l);
                    if (opt) OptionClicker.select(opt);
                });

                progressMgr.update(++done);
                await new Promise(r => setTimeout(r, 80));
            }

            progressMgr.hide();
            toast(`✅ 完成！已作答 ${done} 题`);

            // 缓存数据，供复核使用
            lastQAData = { questions, answers };
            // 显示复核按钮
            const reviewBtn = $('#my-btn-review');
            if (reviewBtn) reviewBtn.style.display = 'block';

        } catch (err) {
            progressMgr.hide();
            toast(`❌ 错误：${err.message}`);
            log('err', err.message, err);
        } finally {
            btn.disabled = false;
            btn.textContent = '✅ 智能作答';
        }
    }

    async function doReview() {
        if (!lastQAData) {
            toast('⚠️ 请先完成作答再复核');
            return;
        }

        const { questions, answers } = lastQAData;
        const apiKey = GM_getValue('my_ai_key', '');
        if (!apiKey) { toast('❌ 缺少 API Key'); return; }

        const btn = $('#my-btn-review');
        btn.disabled = true;
        btn.textContent = '🔍 复核中...';

        try {
            const ai = new AIClient(apiKey);
            const review = await ai.reviewAnswers(questions, answers);
            showReviewModal(questions, answers, review);
            toast('✅ 复核完成');
        } catch (err) {
            toast(`❌ 复核失败：${err.message}`);
        } finally {
            btn.disabled = false;
            btn.textContent = '🔍 答案复核';
        }
    }

    function showReviewModal(questions, answers, review) {
        // 移除旧弹窗
        const old = $('#my-review-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'my-review-modal';

        let html = `<span class="modal-close" onclick="this.parentElement.remove()">✕</span>
                    <h3 style="margin-top:0;">🔍 AI 答案复核</h3>`;

        questions.forEach(q => {
            const r = review[q.id];
            if (!r) return;
            const cls = r.correct ? 'ok' : 'maybe';
            const icon = r.correct ? '✅ 确认正确' : '⚠️ 可能需要检查';
            html += `<div class="review-card ${cls}">
                <strong>${q.id}</strong> [${q.type}] ${q.title.slice(0, 50)}...<br>
                已选：${answers[q.id] || '无'}　${icon}<br>
                💬 ${r.explanation}
            </div>`;
        });

        modal.innerHTML = html;
        document.body.appendChild(modal);
        modal.style.display = 'block';
    }

    // ==================== 构建 UI ====================
    function buildUI() {
        if ($('#my-ai-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'my-ai-panel';
        panel.innerHTML = `
            <div class="head">${APP.name} V${APP.version}</div>
            <div class="body">
                <button id="my-btn-answer" class="btn-answer">✅ 智能作答</button>
                <div id="my-progress">
                    <div class="info"></div>
                    <div class="bar-track"><div class="bar-fill"></div></div>
                </div>
                <button id="my-btn-review" class="btn-review" style="display:none;">🔍 答案复核</button>
                <button id="my-btn-next" class="btn-next">➡️ 跳转下一题</button>
                <button id="my-btn-config" class="btn-config">⚙️ 配置 API Key</button>
            </div>
        `;
        document.body.appendChild(panel);

        $('#my-btn-answer').onclick = doAnswer;
        $('#my-btn-review').onclick = doReview;
        $('#my-btn-next').onclick = () => {
            const btn = findNextButton();
            if (btn) { btn.click(); toast('已跳转下一题'); }
            else toast('未找到下一题按钮');
        };
        $('#my-btn-config').onclick = () => {
            const current = GM_getValue('my_ai_key', '');
            const key = prompt('API Key（留空取消）:', current);
            if (key !== null && key.trim()) {
                GM_setValue('my_ai_key', key.trim());
                toast('✅ Key 已更新');
            }
        };
    }

    // ==================== 初始化 ====================
    function init() {
        injectStyles();
        buildUI();

        // 注册菜单命令（Tampermonkey 菜单）
        GM_registerMenuCommand('🔑 设置 API Key', () => {
            const key = prompt('API Key:', GM_getValue('my_ai_key', ''));
            if (key?.trim()) GM_setValue('my_ai_key', key.trim());
        });

        log('ok', `已启动 (${APP.version})`);
        toast('✅ AI 助手已就绪');
    }

    // DOM 准备好后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 定期检查 UI 是否存在（防止 SPA 页面切换导致丢失）
    setInterval(() => {
        if (!document.getElementById('my-ai-panel')) buildUI();
    }, 5000);

})();
这是什么