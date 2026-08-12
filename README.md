# monkey-scripts
> Scripts for Tampermonkey.

Current scripts:

- `chatgpt-auto-temporary-chat.user.js`: automatically enables temporary chat on ChatGPT.
- `disable-autofocus.user.js`: prevents any website from auto-focusing text inputs, textareas, or contenteditable fields on page load so the page doesn't steal your keyboard; stops blocking the moment you actually interact.
- `github-pr-enhancement.user.js`: adds copyable comment IDs beside timestamps on GitHub PR pages and cleans noisy sections from `.patch` pages and raw patch URLs.
- `hackernews-reader-mode.user.js`: rewrites Hacker News item pages as a single clean article so iOS Safari Reader Mode can read the thread aloud, flattening nested comments with spoken parent attribution (e.g. "bob replying to alice").
- `praise-timesheet-balance.user.js`: adds an "Extra / Short" card to Praise timesheets, showing total worked hours minus worked days × 8h.
- `reddit-enhancements.user.js`: removes the `old.reddit.com` sidebar (`div.side` / `aside.read-next`) so the middle column uses the full viewport width, which reads better on mobile.
- `slack-custom-experience.user.js`: personal Slack web tweaks. Currently frees `Cmd+Shift+A` (Slack's "All unreads") by swallowing it before Slack's handler without preventing default, so the browser keybinding (e.g. Brave tab search) wins.
- `slack-emoji-for-github.user.js`: caches Slack custom emoji names and adds GitHub textarea autocomplete.
- `video-custom-speed.user.js`: applies preferred playback speeds on YouTube, Bilibili, and X/Twitter (handles X's data-saver tap-to-play).
- `vimium-lite.user.js`: a single-file recreation of [Vimium](https://github.com/philc/vimium) in the spirit of a content script — keyboard-driven link hints (`f`/`F`/`yf`), scrolling (`h/j/k/l`, `gg`/`G`, `d`/`u`, `zH`/`zL`), find (`/`, `n`/`N`), history (`H`/`L`), URL hierarchy (`gu`/`gU`), local marks (`m{a-z}`/`` `{a-z}` ``), insert mode (`i`/`Esc`), count prefixes (e.g. `5j`), and a `?` help dialog. Tab and bookmark commands are intentionally omitted since they need extension APIs a userscript can't reach.
- `x-native-share.user.js`: adds a "Share via system…" entry to X/Twitter's share dropdown that opens the OS share sheet (iOS Safari) with the post text and URL.
- `x-video-downloader.user.js`: adds a Save button to videos in X/Twitter posts and downloads the highest-bitrate MP4 variant.
- `youtube-enhancements.user.js`: removes YouTube thumbnails, auto-unmutes video pages, and keeps iOS background playback alive.
