// ==UserScript==
// @name         7TV Emotes for Kick (Safari)
// @namespace    https://7tv.app/
// @version      1.1.0
// @description  Displays 7TV emotes in Kick chat for Safari with autocomplete support
// @author       pitrs
// @match        https://kick.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// @homepage     https://github.com/Pitrsak/7tv-twitch-safari
// ==/UserScript==

(function() {
    'use strict';
    

    const emoteCache = new Map();
    let currentChannel = null;
    let currentKickId = null;
    let chatObserver = null;
    let autocompleteObserver = null;

    // === Styles ===
    GM_addStyle(`
        .seventv-emote {
            display: inline-flex;
            align-items: center;
            vertical-align: middle;
            margin: -5px 2px;
        }
        .seventv-emote img {
            max-height: 28px;
            width: auto;
            vertical-align: middle;
            cursor: pointer;
        }
        .seventv-tooltip {
            position: fixed;
            background: #18181b;
            border: 1px solid #3d3d40;
            border-radius: 6px;
            padding: 8px 12px;
            z-index: 99999;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .seventv-tooltip.visible { opacity: 1; }
        .seventv-tooltip img { max-height: 64px; max-width: 128px; }
        .seventv-tooltip .name { color: #efeff1; font-size: 13px; font-weight: 600; }
        .seventv-tooltip .source { font-size: 11px; }
        .seventv-tooltip .source.seventv { color: #29b6f6; }
        .seventv-native-item {
            display: flex;
            align-items: center;
            padding: 5px 10px;
            cursor: pointer;
            gap: 10px;
        }
        .seventv-native-item:hover,
        .seventv-native-item.seventv-selected {
            background: rgba(83, 83, 95, 0.48);
        }
        .seventv-native-item img {
            height: 28px;
            width: 28px;
            object-fit: contain;
        }
        .seventv-native-item .emote-name {
            color: #efeff1;
            font-size: 14px;
            flex: 1;
        }
        .seventv-native-item .emote-source {
            font-size: 10px;
            font-weight: 600;
        }
        .seventv-native-item .emote-source.seventv { color: #29b6f6; }
        .seventv-separator {
            height: 1px;
            background: #3d3d40;
            margin: 5px 0;
        }
        .seventv-header {
            padding: 5px 10px;
            color: #adadb8;
            font-size: 11px;
            font-weight: 600;
        }
    `);

    // === API ===
    async function fetchJSON(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return null;
            }
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    async function getKickUserId(channelName) {
        try {
            const response = await fetch(`https://kick.com/api/v1/channels/${channelName}`);
            const data = await response.json();
            const id = data?.id || data?.user?.id || null;
            return id;
        } catch (e) {
            return null;
        }
    }

    // === Emote Loaders ===
    function get7TVEmoteUrl(emote, size = '2x') {
        const host = emote.data?.host || emote.host;
        const files = host?.files;
        if (!files || !host?.url) return null;
        const file = files.find(f => f.name === `${size}.webp`) || files[0];
        if (!file) return null;
        const url = host.url.startsWith('//') ? `https:${host.url}` : host.url;
        return `${url}/${file.name}`;
    }

    async function load7TVGlobal() {
        const data = await fetchJSON('https://7tv.io/v3/emote-sets/global');
        let count = 0;
        data?.emotes?.forEach(emote => {
            const url = get7TVEmoteUrl(emote);
            if (url) {
                emoteCache.set(emote.name, { url, url4x: get7TVEmoteUrl(emote, '4x') || url, name: emote.name, source: '7TV' });
                count++;
            }
        });
    }

    async function getTwitchUserIdFallback(channelName) {
        try {
            const response = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${channelName}`);
            const data = await response.json();
            if (data && data.length > 0 && data[0].id) {
                return data[0].id;
            }
        } catch (e) {
        }
        return null;
    }

    async function load7TVChannelTwitchFallback(twitchId) {
        const data = await fetchJSON(`https://7tv.io/v3/users/twitch/${twitchId}`);
        let count = 0;
        data?.emote_set?.emotes?.forEach(emote => {
            const url = get7TVEmoteUrl(emote);
            if (url) {
                emoteCache.set(emote.name, { url, url4x: get7TVEmoteUrl(emote, '4x') || url, name: emote.name, source: '7TV' });
                count++;
            }
        });
        return count > 0;
    }

    async function load7TVChannel(kickId) {
        const data = await fetchJSON(`https://7tv.io/v3/users/kick/${kickId}`);
        let count = 0;
        data?.emote_set?.emotes?.forEach(emote => {
            const url = get7TVEmoteUrl(emote);
            if (url) {
                emoteCache.set(emote.name, { url, url4x: get7TVEmoteUrl(emote, '4x') || url, name: emote.name, source: '7TV' });
                count++;
            }
        });
        return count > 0;
    }

    async function loadAllEmotes(channelName, kickId) {
        await load7TVGlobal();
        if (kickId) {
            const loadedKick = await load7TVChannel(kickId);
            if (!loadedKick) {
                const twitchId = await getTwitchUserIdFallback(channelName);
                if (twitchId) {
                    await load7TVChannelTwitchFallback(twitchId);
                }
            }
        }
    }

    // === Tooltip ===
    let tooltip = null;

    function createTooltip() {
        tooltip = document.createElement('div');
        tooltip.className = 'seventv-tooltip';
        tooltip.innerHTML = '<img><span class="name"></span><span class="source"></span>';
        document.body.appendChild(tooltip);
    }

    function showTooltip(emote, target) {
        if (!tooltip) createTooltip();
        tooltip.querySelector('img').src = emote.url4x || emote.url;
        tooltip.querySelector('.name').textContent = emote.name;
        const sourceEl = tooltip.querySelector('.source');
        sourceEl.textContent = emote.source;
        sourceEl.className = 'source ' + emote.source.toLowerCase();

        const rect = target.getBoundingClientRect();
        tooltip.style.left = Math.max(10, rect.left + rect.width / 2 - 60) + 'px';
        tooltip.style.top = (rect.top < 110 ? rect.bottom + 10 : rect.top - 100) + 'px';
        tooltip.classList.add('visible');
    }

    function hideTooltip() {
        tooltip?.classList.remove('visible');
    }

    // === Replace Emotes in Chat ===
    function replaceEmotesInText(textNode) {
        const text = textNode.textContent;
        if (!text?.trim()) return false;

        const words = text.split(/(\s+)/);
        if (!words.some(w => emoteCache.has(w))) return false;

        const fragment = document.createDocumentFragment();
        let replaced = false;
        words.forEach(word => {
            const emote = emoteCache.get(word);
            if (emote) {
                const span = document.createElement('span');
                span.className = 'seventv-emote';
                const img = document.createElement('img');
                img.src = emote.url;
                img.alt = emote.name;
                img.addEventListener('mouseenter', () => showTooltip(emote, img));
                img.addEventListener('mouseleave', hideTooltip);
                span.appendChild(img);
                fragment.appendChild(span);
                replaced = true;
            } else {
                fragment.appendChild(document.createTextNode(word));
            }
        });

        try {
            textNode.parentNode.replaceChild(fragment, textNode);
            return replaced;
        } catch { return false; }
    }

    function processElement(element) {
        if (!element || element.dataset?.seventvProcessed) return;
        if (element.closest && element.closest('.seventv-kick-autocomplete-container')) return;
        if (element.dataset) element.dataset.seventvProcessed = 'true';

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                if (node.parentElement?.classList?.contains('seventv-emote')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) textNodes.push(node);
        
        let emotesReplaced = false;
        textNodes.forEach(n => {
            if (replaceEmotesInText(n)) emotesReplaced = true;
        });
        
        if (emotesReplaced) {
        }
    }

    // === Autocomplete ===
    function getCurrentQuery() {
        const input = document.querySelector('.editor-input') || document.querySelector('.ProseMirror') || document.querySelector('#chat-input') || document.querySelector('[contenteditable="true"]');
        if (!input) return null;
        
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        
        if (!input.contains(range.startContainer)) return null;

        const preCursorRange = range.cloneRange();
        preCursorRange.selectNodeContents(input);
        preCursorRange.setEnd(range.startContainer, range.startOffset);
        const text = preCursorRange.toString();
        
        const match = text.match(/:(\S+)$/);
        return match ? match[1].toLowerCase() : null;
    }

    function getMatchingEmotes(query) {
        if (!query) return [];
        const matches = [];
        emoteCache.forEach((emote) => {
            const lowerName = emote.name.toLowerCase();
            if (lowerName.includes(query)) {
                matches.push({ ...emote, sortKey: (lowerName.startsWith(query) ? 0 : 1000) + emote.name.length });
            }
        });
        matches.sort((a, b) => a.sortKey - b.sortKey);
        return matches.slice(0, 10);
    }

    function createEmoteItem(emote, onClick) {
        const item = document.createElement('div');
        item.className = 'seventv-native-item';
        item.setAttribute('data-seventv-emote', emote.name);
        item.innerHTML = `<img src="${emote.url}" alt="${emote.name}"><span class="emote-name">${emote.name}</span><span class="emote-source ${emote.source.toLowerCase()}">${emote.source}</span>`;
        // Prevent generic focus loss on mousedown so input range is maintained
        item.addEventListener('mousedown', (e) => { e.preventDefault(); });
        item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(emote.name); });
        return item;
    }

    function insertEmote(emoteName) {
        const input = document.querySelector('.editor-input') || document.querySelector('.ProseMirror') || document.querySelector('#chat-input') || document.querySelector('[contenteditable="true"]');
        if (!input) return;

        input.focus();
        
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);

        if (!input.contains(range.startContainer)) return;

        const preCursorRange = range.cloneRange();
        preCursorRange.selectNodeContents(input);
        preCursorRange.setEnd(range.startContainer, range.startOffset);
        const match = preCursorRange.toString().match(/:(\S+)$/);
        const charsToDelete = match ? match[0].length : 0;

        if (charsToDelete > 0 && range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset >= charsToDelete) {
            range.setStart(range.endContainer, range.endOffset - charsToDelete);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            for (let i = 0; i < charsToDelete; i++) {
                document.execCommand('delete', false, null);
            }
        }

        document.execCommand('insertText', false, emoteName + ' ');

        setTimeout(() => {
            input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            input.focus();
        }, 10);
    }

    function findAutocompleteListbox() {
        let container = document.querySelector('.seventv-kick-autocomplete-container');
        if (!container) {
            const chatroom = document.getElementById('channel-chatroom') || document.querySelector('.chat-message-list')?.parentElement || document.body;
            if (chatroom) {
               container = document.createElement('div');
               container.className = 'seventv-kick-autocomplete-container';
               container.style.cssText = 'position: absolute; bottom: 85px; left: 10px; z-index: 999999; max-height: 250px; overflow-y: auto; background: #18181b; border-radius: 6px; border: 1px solid #3d3d40; box-shadow: 0 4px 12px rgba(0,0,0,0.6); padding-bottom: 5px; width: calc(100% - 20px);';
               if (chatroom !== document.body) chatroom.style.position = 'relative';
               chatroom.appendChild(container);
            }
        }
        return container;
    }

    let lastQuery = null;

    function injectIntoAutocomplete(container) {
        if (!container) return;
        const query = getCurrentQuery();
        if (!query) {
            container.style.display = 'none';
            lastQuery = null;
            return;
        }

        if (query === lastQuery) return;
        lastQuery = query;

        const matches = getMatchingEmotes(query);
        if (matches.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'seventv-header';
        header.textContent = '7TV Emotes';
        container.appendChild(header);

        matches.forEach(emote => {
            container.appendChild(createEmoteItem(emote, insertEmote));
        });
    }

    function setupAutocompleteInjection() {
        let ourSelectedIndex = -1;
        let activeNavigation = false;

        setInterval(() => {
            const container = findAutocompleteListbox();
            if (container) {
                injectIntoAutocomplete(container);
            }
        }, 200);

        window.addEventListener('keydown', (e) => {
            const container = document.querySelector('.seventv-kick-autocomplete-container');
            if (!container || container.style.display === 'none') return;
            
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const ourItems = Array.from(container.querySelectorAll('.seventv-native-item'));
                if (ourItems.length === 0) return;

                e.preventDefault();
                e.stopImmediatePropagation();
                activeNavigation = true;

                if (e.key === 'ArrowDown') {
                    ourSelectedIndex = Math.min(ourSelectedIndex + 1, ourItems.length - 1);
                } else {
                    ourSelectedIndex--;
                    if (ourSelectedIndex < 0) {
                        ourSelectedIndex = 0;
                    }
                }

                ourItems.forEach(item => item.classList.remove('seventv-selected'));
                if (ourItems[ourSelectedIndex]) {
                    ourItems[ourSelectedIndex].classList.add('seventv-selected');
                    ourItems[ourSelectedIndex].scrollIntoView({ block: 'nearest' });
                }
                return;
            }

            if (e.key === 'Tab') {
                const ourItems = Array.from(container.querySelectorAll('.seventv-native-item'));
                if (ourItems.length === 0) return;

                e.preventDefault();
                e.stopImmediatePropagation();

                const selected = ourItems.find(item => item.classList.contains('seventv-selected')) || (ourSelectedIndex >= 0 ? ourItems[ourSelectedIndex] : ourItems[0]);
                const emoteName = selected?.getAttribute('data-seventv-emote');
                if (emoteName) {
                    insertEmote(emoteName);
                    ourSelectedIndex = -1;
                    activeNavigation = false;
                    container.style.display = 'none';
                }
                return;
            }
            
            // Allow typing to continue naturally but reset active visual hook
            if (e.key !== 'Escape' && e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt') {
                activeNavigation = false;
            }
        }, true);

        document.addEventListener('input', () => {
            ourSelectedIndex = -1;
            activeNavigation = false;
        }, true);
    }

    // === Chat Observer ===
    function findChatContainer() {
        const selectors = [
            '#channel-chatroom',
            '#chat-history',
            '.chat-history',
            '.chat-message-list',
            '#chat-messages',
            '#chat-container',
            '[data-chat]',
            '.chat-room',
            '#chat'
        ];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) return el;
        }
        return null;
    }

    function observeChat() {
        if (chatObserver) chatObserver.disconnect();
        const container = findChatContainer();
        if (!container) {
            return;
        }
        

        chatObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        processElement(node);
                        node.querySelectorAll?.('*').forEach(processElement);
                    }
                }
            }
        });
        chatObserver.observe(container, { childList: true, subtree: true });
    }

    // === Channel Detection ===
    function getChannelFromURL() {
        const match = window.location.pathname.match(/^\/([a-zA-Z0-9_]+)/);
        if (match) {
            const name = match[1].toLowerCase();
            const excluded = ['directory', 'categories', 'dashboard', 'settings', 'following', 'search', 'auth'];
            if (!excluded.includes(name)) return name;
        }
        return null;
    }

    async function handleChannelChange() {
        const channel = getChannelFromURL();
        if (!channel || channel === currentChannel) return;

        currentChannel = channel;
        currentKickId = await getKickUserId(channel);
        emoteCache.clear();
        await loadAllEmotes(channel, currentKickId);

        document.querySelectorAll('[data-seventv-processed]').forEach(el => delete el.dataset.seventvProcessed);
        
        const chatC = findChatContainer();
        if (chatC) {
            chatC.querySelectorAll('*').forEach(processElement);
            observeChat();
        } else {
        }
    }

    // === Init ===
    async function init() {
        createTooltip();
        setupAutocompleteInjection();

        const channel = getChannelFromURL();
        if (channel) {
            currentChannel = channel;
            currentKickId = await getKickUserId(channel);
            await loadAllEmotes(channel, currentKickId);
        }

        let chatAttempts = 0;
        const waitForChat = () => {
            const container = findChatContainer();
            if (container) {
                setTimeout(() => {
                    container.querySelectorAll('*').forEach(processElement);
                    observeChat();
                }, 500);
            } else {
                chatAttempts++;
                if (chatAttempts < 20) {
                    setTimeout(waitForChat, 500);
                } else {
                }
            }
        };
        waitForChat();

        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                handleChannelChange();
                setTimeout(observeChat, 1000);
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    } else {
        setTimeout(init, 1000);
    }
})();
