// ==UserScript==
// @name         7TV/BTTV/FFZ Emotes for Twitch (Safari)
// @namespace    https://7tv.app/
// @version      5.0.0
// @description  Displays 7TV, BTTV and FFZ emotes in Twitch chat for Safari with autocomplete support
// @author       pitrs
// @match        https://www.twitch.tv/*
// @grant        GM_addStyle
// @run-at       document-idle
// @homepage     https://github.com/Pitrsak/7tv-twitch-safari
// ==/UserScript==

(function() {
    'use strict';

    const emoteCache = new Map();
    let currentChannel = null;
    let currentTwitchId = null;
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
        .seventv-tooltip .source.bttv { color: #d50014; }
        .seventv-tooltip .source.ffz { color: #a8a8a8; }
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
        .seventv-native-item .emote-source.bttv { color: #d50014; }
        .seventv-native-item .emote-source.ffz { color: #a8a8a8; }
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
        .autocomplete-match-list {
            max-height: 350px !important;
            overflow-y: auto !important;
        }
    `);

    // === API ===
    async function fetchJSON(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    async function getTwitchUserId(channelName) {
        try {
            const response = await fetch('https://gql.twitch.tv/gql', {
                method: 'POST',
                headers: {
                    'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: `query { user(login: "${channelName}") { id } }`
                })
            });
            const data = await response.json();
            return data?.data?.user?.id || null;
        } catch {
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
        data?.emotes?.forEach(emote => {
            const url = get7TVEmoteUrl(emote);
            if (url) emoteCache.set(emote.name, { url, url4x: get7TVEmoteUrl(emote, '4x') || url, name: emote.name, source: '7TV' });
        });
    }

    async function load7TVChannel(twitchId) {
        const data = await fetchJSON(`https://7tv.io/v3/users/twitch/${twitchId}`);
        data?.emote_set?.emotes?.forEach(emote => {
            const url = get7TVEmoteUrl(emote);
            if (url) emoteCache.set(emote.name, { url, url4x: get7TVEmoteUrl(emote, '4x') || url, name: emote.name, source: '7TV' });
        });
    }

    async function loadBTTVGlobal() {
        const data = await fetchJSON('https://api.betterttv.net/3/cached/emotes/global');
        data?.forEach(emote => {
            emoteCache.set(emote.code, {
                url: `https://cdn.betterttv.net/emote/${emote.id}/2x.webp`,
                url4x: `https://cdn.betterttv.net/emote/${emote.id}/3x.webp`,
                name: emote.code,
                source: 'BTTV'
            });
        });
    }

    async function loadBTTVChannel(twitchId) {
        const data = await fetchJSON(`https://api.betterttv.net/3/cached/users/twitch/${twitchId}`);
        if (data) {
            [...(data.channelEmotes || []), ...(data.sharedEmotes || [])].forEach(emote => {
                emoteCache.set(emote.code, {
                    url: `https://cdn.betterttv.net/emote/${emote.id}/2x.webp`,
                    url4x: `https://cdn.betterttv.net/emote/${emote.id}/3x.webp`,
                    name: emote.code,
                    source: 'BTTV'
                });
            });
        }
    }

    async function loadFFZGlobal() {
        const data = await fetchJSON('https://api.frankerfacez.com/v1/set/global');
        loadFFZEmotes(data);
    }

    async function loadFFZChannel(twitchId) {
        const data = await fetchJSON(`https://api.frankerfacez.com/v1/room/id/${twitchId}`);
        loadFFZEmotes(data);
    }

    function loadFFZEmotes(data) {
        if (!data?.sets) return;
        Object.values(data.sets).forEach(set => {
            set.emoticons?.forEach(emote => {
                const url = emote.urls?.['2'] || emote.urls?.['1'];
                if (url) {
                    emoteCache.set(emote.name, {
                        url: url.startsWith('//') ? `https:${url}` : url,
                        url4x: (emote.urls?.['4'] || url).replace(/^\/\//, 'https://'),
                        name: emote.name,
                        source: 'FFZ'
                    });
                }
            });
        });
    }

    async function loadAllEmotes(channelName, twitchId) {
        await Promise.all([load7TVGlobal(), loadBTTVGlobal(), loadFFZGlobal()]);
        if (twitchId) {
            await Promise.all([load7TVChannel(twitchId), loadBTTVChannel(twitchId), loadFFZChannel(twitchId)]);
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
            } else {
                fragment.appendChild(document.createTextNode(word));
            }
        });

        try {
            textNode.parentNode.replaceChild(fragment, textNode);
            return true;
        } catch { return false; }
    }

    function processElement(element) {
        if (!element || element.dataset?.seventvProcessed) return;
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
        textNodes.forEach(replaceEmotesInText);
    }

    // === Autocomplete ===
    function getCurrentQuery() {
        const input = document.querySelector('[data-a-target="chat-input"]');
        if (!input) return null;
        const text = (input.innerText || input.textContent || '').trim();
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
        item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(emote.name); });
        return item;
    }

    function insertEmote(emoteName) {
        const input = document.querySelector('[data-a-target="chat-input"]');
        if (!input) return;

        input.focus();
        const text = (input.innerText || '').replace(/[\n\r]/g, '').trim();
        const match = text.match(/:(\S*)$/);
        const charsToDelete = match ? match[0].length : 0;

        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        for (let i = 0; i < charsToDelete; i++) {
            document.execCommand('delete', false, null);
        }
        document.execCommand('insertText', false, emoteName + ' ');

        setTimeout(() => {
            input.focus();
            const newRange = document.createRange();
            newRange.selectNodeContents(input);
            newRange.collapse(false);
            sel.removeAllRanges();
            sel.addRange(newRange);
        }, 10);

        setTimeout(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }, 50);
    }

    function findAutocompleteListbox() {
        const matchList = document.querySelector('.autocomplete-match-list');
        if (matchList?.getBoundingClientRect().height > 50) return matchList;

        for (const listbox of document.querySelectorAll('[role="listbox"]')) {
            if (listbox.querySelectorAll('[role="option"]').length > 0) {
                const rect = listbox.getBoundingClientRect();
                if (rect.width > 100 && rect.height > 50) return listbox;
            }
        }
        return null;
    }

    function injectIntoAutocomplete(listbox) {
        if (listbox.querySelector('.seventv-native-item')) return;
        const query = getCurrentQuery();
        if (!query) return;

        const matches = getMatchingEmotes(query);
        if (matches.length === 0) return;

        const container = listbox.querySelector('[class*="scrollable"]') || listbox;

        const separator = document.createElement('div');
        separator.className = 'seventv-separator';
        container.appendChild(separator);

        const header = document.createElement('div');
        header.className = 'seventv-header';
        header.textContent = '7TV / BTTV / FFZ';
        container.appendChild(header);

        matches.forEach(emote => {
            container.appendChild(createEmoteItem(emote, insertEmote));
        });
    }

    function setupAutocompleteInjection() {
        let inOurSection = false;
        let ourSelectedIndex = -1;

        // Check for autocomplete periodically
        setInterval(() => {
            const query = getCurrentQuery();
            if (!query) return;
            const listbox = findAutocompleteListbox();
            if (listbox && !listbox.querySelector('.seventv-native-item')) {
                injectIntoAutocomplete(listbox);
            }
        }, 200);

        // Watch for DOM changes
        autocompleteObserver = new MutationObserver(() => {
            if (!getCurrentQuery()) return;
            setTimeout(() => {
                const listbox = findAutocompleteListbox();
                if (listbox && !listbox.querySelector('.seventv-native-item')) {
                    injectIntoAutocomplete(listbox);
                }
            }, 50);
        });
        autocompleteObserver.observe(document.body, { childList: true, subtree: true });

        // Ctrl/Cmd + Down = jump to our section
        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && (e.ctrlKey || e.metaKey)) {
                const listbox = findAutocompleteListbox();
                if (!listbox) return;
                const ourItems = Array.from(listbox.querySelectorAll('.seventv-native-item'));
                if (ourItems.length === 0) return;

                e.preventDefault();
                e.stopImmediatePropagation();
                inOurSection = true;
                ourSelectedIndex = 0;
                ourItems.forEach(item => item.classList.remove('seventv-selected'));
                ourItems[0].classList.add('seventv-selected');
                ourItems[0].scrollIntoView({ block: 'nearest' });
            }
        }, true);

        // Arrow navigation in our section
        window.addEventListener('keydown', (e) => {
            if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.ctrlKey || e.metaKey || !inOurSection) return;

            const listbox = findAutocompleteListbox();
            if (!listbox) return;
            const ourItems = Array.from(listbox.querySelectorAll('.seventv-native-item'));
            if (ourItems.length === 0) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            if (e.key === 'ArrowDown') {
                ourSelectedIndex = Math.min(ourSelectedIndex + 1, ourItems.length - 1);
            } else {
                ourSelectedIndex--;
                if (ourSelectedIndex < 0) {
                    inOurSection = false;
                    ourSelectedIndex = -1;
                    ourItems.forEach(item => item.classList.remove('seventv-selected'));
                    return;
                }
            }

            ourItems.forEach(item => item.classList.remove('seventv-selected'));
            ourItems[ourSelectedIndex].classList.add('seventv-selected');
            ourItems[ourSelectedIndex].scrollIntoView({ block: 'nearest' });
        }, true);

        // Tab = select emote
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const listbox = findAutocompleteListbox();
            if (!listbox) return;

            const ourItems = Array.from(listbox.querySelectorAll('.seventv-native-item'));
            if (ourItems.length === 0) return;

            const nativeCount = listbox.querySelectorAll('[role="option"]').length - ourItems.length;
            if (!inOurSection && nativeCount > 0) return;

            const selected = ourItems.find(item => item.classList.contains('seventv-selected')) || ourItems[0];
            const emoteName = selected?.getAttribute('data-seventv-emote');
            if (emoteName) {
                e.preventDefault();
                e.stopImmediatePropagation();
                insertEmote(emoteName);
                inOurSection = false;
                ourSelectedIndex = -1;
            }
        }, true);

        // Enter = select emote in our section
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || !inOurSection) return;
            const listbox = findAutocompleteListbox();
            if (!listbox) return;

            const ourItems = Array.from(listbox.querySelectorAll('.seventv-native-item'));
            const selected = ourItems.find(item => item.classList.contains('seventv-selected')) || (ourSelectedIndex >= 0 ? ourItems[ourSelectedIndex] : null);
            const emoteName = selected?.getAttribute('data-seventv-emote');
            if (emoteName) {
                e.preventDefault();
                e.stopImmediatePropagation();
                insertEmote(emoteName);
                inOurSection = false;
                ourSelectedIndex = -1;
            }
        }, true);

        // Reset on input
        document.addEventListener('input', () => {
            inOurSection = false;
            ourSelectedIndex = -1;
            document.querySelectorAll('.seventv-native-item.seventv-selected').forEach(el => el.classList.remove('seventv-selected'));
        }, true);

        // Re-inject on input change
        document.addEventListener('input', (e) => {
            if (!e.target.closest?.('[data-a-target="chat-input"]')) return;
            setTimeout(() => {
                const listbox = findAutocompleteListbox();
                if (listbox) {
                    listbox.querySelectorAll('.seventv-native-item, .seventv-separator, .seventv-header').forEach(el => el.remove());
                    injectIntoAutocomplete(listbox);
                }
            }, 150);
        }, true);
    }

    // === Chat Observer ===
    function findChatContainer() {
        return document.querySelector('.chat-scrollable-area__message-container') || document.querySelector('[role="log"]');
    }

    function observeChat() {
        if (chatObserver) chatObserver.disconnect();
        const container = findChatContainer();
        if (!container) {
            setTimeout(observeChat, 1000);
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
            const excluded = ['directory', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'friends', 'messages', 'videos', 'moderator', 'u', 'search', 'downloads', 'turbo', 'jobs', 'p', 'user', 'team', 'popout', 'prime', 'bits'];
            if (!excluded.includes(name)) return name;
        }
        return null;
    }

    async function handleChannelChange() {
        const channel = getChannelFromURL();
        if (!channel || channel === currentChannel) return;

        currentChannel = channel;
        currentTwitchId = await getTwitchUserId(channel);
        emoteCache.clear();
        await loadAllEmotes(channel, currentTwitchId);

        document.querySelectorAll('[data-seventv-processed]').forEach(el => delete el.dataset.seventvProcessed);
        findChatContainer()?.querySelectorAll('*').forEach(processElement);
    }

    // === Init ===
    async function init() {
        createTooltip();
        setupAutocompleteInjection();

        const channel = getChannelFromURL();
        if (channel) {
            currentChannel = channel;
            currentTwitchId = await getTwitchUserId(channel);
            await loadAllEmotes(channel, currentTwitchId);
        }

        const waitForChat = () => {
            const container = findChatContainer();
            if (container) {
                setTimeout(() => {
                    container.querySelectorAll('*').forEach(processElement);
                    observeChat();
                }, 500);
            } else {
                setTimeout(waitForChat, 500);
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
