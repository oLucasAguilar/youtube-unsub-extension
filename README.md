# YouTube Quick Unsubscribe

Chrome/Brave extension that adds an Unsubscribe button on YouTube home feed video cards. No need to visit the channel page.

## Install

1. Clone or download this repo
2. Go to `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select this folder

## How it works

Hover any video card on the home feed and click Unsubscribe. Uses YouTube's internal API with your existing session, no API keys needed.

## Permissions

- `cookies` - reads your YouTube session cookie to authenticate
- `scripting` - reads YouTube's internal config from the page
- `https://www.youtube.com/*` - runs only on YouTube
