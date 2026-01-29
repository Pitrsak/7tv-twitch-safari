# 7TV/BTTV/FFZ Emotes for Twitch (Safari)

A Tampermonkey/userscript that brings 7TV, BTTV, and FFZ emotes to Twitch on Safari (and other browsers without native extension support).

## Features

- Displays 7TV, BTTV, and FFZ emotes in Twitch chat
- Autocomplete support - type `:` followed by emote name to search
- Integrates into native Twitch autocomplete menu
- Hover tooltips showing emote name and source
- Automatic channel detection and emote loading
- Supports both global and channel-specific emotes

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. Click [here](../../raw/main/7tv-twitch-safari.user.js) to install the script
3. Go to any Twitch channel and enjoy emotes

## Usage

### Viewing Emotes
Emotes are automatically displayed in chat messages.

### Autocomplete
1. Type `:` followed by part of an emote name (e.g., `:peepo`)
2. The native Twitch autocomplete will show matching emotes from 7TV, BTTV, and FFZ
3. Use `Ctrl+Down` to jump to the 7TV/BTTV/FFZ section
4. Navigate with arrow keys
5. Press `Tab` or `Enter` to insert the emote

### Tooltips
Hover over any emote to see its name and source (7TV, BTTV, or FFZ).

## Supported APIs

- [7TV API v3](https://7tv.io/)
- [BetterTTV API](https://betterttv.com/)
- [FrankerFaceZ API](https://www.frankerfacez.com/)

## License

MIT
