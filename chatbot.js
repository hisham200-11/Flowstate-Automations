/**
 * FlowState Automations - Chatbot Widget Controller
 * 
 * Embeds zero-delay AI chatbot connected to /api/chat
 */

(function () {
    'use strict';

    const STORAGE_SESSION_KEY = 'fsa_chat_session_id';
    const STORAGE_MESSAGES_KEY = 'fsa_chat_messages_v1';
    const STORAGE_AUTO_OPEN_KEY = 'fsa_chat_auto_opened';

    const STARTER_CHIPS = [
        '💬 How does it work for Facebook ads?',
        '💰 How much does it cost?',
        '⚡ Can I test a live demo for my page?',
        '📊 Can you connect to Google Sheets?'
    ];

    const INITIAL_BOT_GREETING = {
        role: 'assistant',
        content: "Hey there! 👋 Notice how fast this opened? That sub-2-second speed is exactly what we build for your business inquiries.\n\nAre you running Facebook/IG ads, or looking for custom software automation?"
    };

    // State
    let sessionId = sessionStorage.getItem(STORAGE_SESSION_KEY);
    if (!sessionId) {
        sessionId = 'fsa_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
        sessionStorage.setItem(STORAGE_SESSION_KEY, sessionId);
    }

    let messages = [];
    try {
        const saved = sessionStorage.getItem(STORAGE_MESSAGES_KEY);
        if (saved) {
            messages = JSON.parse(saved);
        }
    } catch (e) {
        messages = [];
    }

    if (messages.length === 0) {
        messages.push(INITIAL_BOT_GREETING);
        saveMessages();
    }

    let isOpen = false;
    let isSubmitting = false;

    function saveMessages() {
        try {
            sessionStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(messages));
        } catch (e) {}
    }

    function initWidget() {
        // Create launcher button
        const launcher = document.createElement('button');
        launcher.className = 'fsa-chat-launcher';
        launcher.setAttribute('aria-label', 'Open FlowState Live Chat');
        launcher.innerHTML = `
            <div class="fsa-launcher-icon-wrap">
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <span class="fsa-launcher-badge-pulse"></span>
            </div>
            <span>Chat Live &bull; &lt;2s</span>
        `;

        // Create widget modal container
        const widget = document.createElement('div');
        widget.className = 'fsa-chat-widget';
        widget.innerHTML = `
            <div class="fsa-chat-header">
                <div class="fsa-header-info">
                    <div class="fsa-header-avatar">
                        <img src="/img/fsa-icon-original.png" alt="FlowState" onerror="this.style.display='none'">
                    </div>
                    <div>
                        <div class="fsa-header-title">FlowState AI Assistant</div>
                        <div class="fsa-header-status">
                            <span class="fsa-status-indicator"></span>
                            <span>⚡ Live &bull; Sub-2s Response</span>
                        </div>
                    </div>
                </div>
                <div class="fsa-header-actions">
                    <button class="fsa-header-btn" id="fsaChatResetBtn" title="Reset conversation">
                        <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>
                    </button>
                    <button class="fsa-header-btn" id="fsaChatCloseBtn" title="Close chat">
                        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>

            <div class="fsa-chat-messages" id="fsaChatMessages"></div>

            <div class="fsa-chat-chips" id="fsaChatChips"></div>

            <div class="fsa-chat-footer">
                <form class="fsa-input-form" id="fsaChatForm">
                    <input type="text" class="fsa-chat-input" id="fsaChatInput" placeholder="Ask about our bots, speed, or pricing..." autocomplete="off" maxlength="500">
                    <button type="submit" class="fsa-send-btn" id="fsaSendBtn" aria-label="Send message">
                        <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                </form>
                <div class="fsa-chat-disclaimer">⚡ Live AI Demo &bull; We build this for your Facebook &amp; IG</div>
            </div>
        `;

        document.body.appendChild(launcher);
        document.body.appendChild(widget);

        // Render initial elements
        renderMessages();
        renderChips();

        // Event Listeners
        launcher.addEventListener('click', toggleChat);
        document.getElementById('fsaChatCloseBtn').addEventListener('click', toggleChat);
        document.getElementById('fsaChatResetBtn').addEventListener('click', resetChat);
        document.getElementById('fsaChatForm').addEventListener('submit', handleFormSubmit);

        // Auto-open on first visit after 8 seconds idle
        const hasAutoOpened = localStorage.getItem(STORAGE_AUTO_OPEN_KEY);
        if (!hasAutoOpened) {
            setTimeout(() => {
                if (!isOpen && !localStorage.getItem(STORAGE_AUTO_OPEN_KEY)) {
                    openChat();
                    localStorage.setItem(STORAGE_AUTO_OPEN_KEY, 'true');
                }
            }, 8000);
        }
    }

    function toggleChat() {
        if (isOpen) {
            closeChat();
        } else {
            openChat();
        }
    }

    function openChat() {
        isOpen = true;
        const widget = document.querySelector('.fsa-chat-widget');
        const launcher = document.querySelector('.fsa-chat-launcher');
        if (widget) widget.classList.add('active');
        if (launcher) launcher.classList.add('hidden');

        localStorage.setItem(STORAGE_AUTO_OPEN_KEY, 'true');
        scrollToBottom();

        setTimeout(() => {
            const input = document.getElementById('fsaChatInput');
            if (input && window.innerWidth > 480) input.focus();
        }, 180);
    }

    function closeChat() {
        isOpen = false;
        const widget = document.querySelector('.fsa-chat-widget');
        const launcher = document.querySelector('.fsa-chat-launcher');
        if (widget) widget.classList.remove('active');
        if (launcher) launcher.classList.remove('hidden');
    }

    function resetChat() {
        if (!confirm('Start a fresh conversation?')) return;
        sessionId = 'fsa_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
        sessionStorage.setItem(STORAGE_SESSION_KEY, sessionId);
        messages = [INITIAL_BOT_GREETING];
        saveMessages();
        renderMessages();
        renderChips();
    }

    function renderMessages() {
        const container = document.getElementById('fsaChatMessages');
        if (!container) return;

        container.innerHTML = '';
        messages.forEach((msg) => {
            appendMessageUI(msg.role, msg.content, false);
        });

        scrollToBottom();
    }

    function appendMessageUI(role, text, shouldScroll = true) {
        const container = document.getElementById('fsaChatMessages');
        if (!container) return;

        const row = document.createElement('div');
        row.className = `fsa-message-row ${role === 'user' ? 'user' : 'bot'}`;

        const bubble = document.createElement('div');
        bubble.className = 'fsa-message-bubble';
        bubble.innerHTML = formatMessageText(text);

        const time = document.createElement('span');
        time.className = 'fsa-message-time';
        const now = new Date();
        time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        row.appendChild(bubble);
        row.appendChild(time);
        container.appendChild(row);

        if (shouldScroll) {
            scrollToBottom();
        }
    }

    function formatMessageText(text) {
        if (!text) return '';
        // Escape HTML
        let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Links
        escaped = escaped.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#38BDF8;text-decoration:underline;">$1</a>'
        );

        // Bold **text**
        escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Newlines to <br>
        return escaped.replace(/\n/g, '<br>');
    }

    function renderChips() {
        const container = document.getElementById('fsaChatChips');
        if (!container) return;

        // Only show starter chips if fewer than 3 total messages
        if (messages.length > 3) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = '';
        STARTER_CHIPS.forEach((chipText) => {
            const btn = document.createElement('button');
            btn.className = 'fsa-chip';
            btn.textContent = chipText;
            btn.type = 'button';
            btn.addEventListener('click', () => {
                const cleanText = chipText.replace(/^[^\w]+/, '').trim();
                sendMessage(cleanText);
            });
            container.appendChild(btn);
        });
    }

    function showTypingIndicator() {
        const container = document.getElementById('fsaChatMessages');
        if (!container || document.getElementById('fsaTypingIndicator')) return;

        const indicator = document.createElement('div');
        indicator.id = 'fsaTypingIndicator';
        indicator.className = 'fsa-typing-indicator';
        indicator.innerHTML = `
            <div class="fsa-typing-dot"></div>
            <div class="fsa-typing-dot"></div>
            <div class="fsa-typing-dot"></div>
        `;
        container.appendChild(indicator);
        scrollToBottom();
    }

    function hideTypingIndicator() {
        const indicator = document.getElementById('fsaTypingIndicator');
        if (indicator) indicator.remove();
    }

    function scrollToBottom() {
        const container = document.getElementById('fsaChatMessages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    async function handleFormSubmit(e) {
        e.preventDefault();
        const input = document.getElementById('fsaChatInput');
        if (!input) return;

        const text = input.value.trim();
        if (!text || isSubmitting) return;

        input.value = '';
        await sendMessage(text);
    }

    async function sendMessage(userText) {
        if (!userText || isSubmitting) return;

        isSubmitting = true;
        const sendBtn = document.getElementById('fsaSendBtn');
        const input = document.getElementById('fsaChatInput');
        if (sendBtn) sendBtn.disabled = true;

        // 1. Add user message
        const userMsg = { role: 'user', content: userText };
        messages.push(userMsg);
        saveMessages();
        appendMessageUI('user', userText, true);
        renderChips();

        // 2. Show typing indicator
        showTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: messages,
                    sessionId: sessionId,
                    pageUrl: window.location.href,
                }),
            });

            hideTypingIndicator();

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            const data = await response.json();
            const botReply = data.reply || "Thanks for your inquiry! How else can FlowState assist your team today?";

            // 3. Add bot message
            const botMsg = { role: 'assistant', content: botReply };
            messages.push(botMsg);
            saveMessages();
            appendMessageUI('bot', botReply, true);
        } catch (err) {
            hideTypingIndicator();
            console.error('Chat error:', err);
            const fallbackMsg = "⚡ FlowState live link: We're available 24/7. You can also email Hisham directly at flowstateautom8t@gmail.com or try messaging again!";
            appendMessageUI('bot', fallbackMsg, true);
        } finally {
            isSubmitting = false;
            if (sendBtn) sendBtn.disabled = false;
            if (input && window.innerWidth > 480) input.focus();
        }
    }

    // Initialize once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        initWidget();
    }
})();
