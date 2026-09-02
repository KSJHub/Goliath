# Goliath Core Emoji Assets

This directory is the canonical source library for Goliath's locked Core application emojis.

The source images are committed once with Goliath and are never copied into individual Discord guild emoji storage. On bot startup, Goliath checks its Discord application emoji pool and creates only missing Core emojis from these files. Existing application emojis are reused.

Locked aliases, in order:

1. `activision`
2. `blizzard`
3. `discord`
4. `epic`
5. `facebook`
6. `instagram`
7. `kick`
8. `nintendo`
9. `pc`
10. `playstation`
11. `snapchat`
12. `steam`
13. `tiktok`
14. `twitch`
15. `whatsapp`
16. `x`
17. `xbox`
18. `youtube`

Preferred source filenames are `<alias>.png`, for example `youtube.png`. The startup matcher also accepts the existing descriptive platform filenames when the alias can be identified unambiguously.

Core files are system assets. Guild Emoji Studio favourites are a separate optional pool and must not own, rename, replace, or delete these Core resources.
