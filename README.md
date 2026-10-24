# The Old Cartographer

A WebXR dungeon. You share a cell with Aldous, an old prisoner who has given up. Say the right things and he warms from hopeless, to grudging, to telling stories, to finally telling you how to escape.

## Folder layout

- `public/index.html` : the game (scene, voice recording, subtitles)
- `netlify/functions/api.mjs` : server code that holds your keys and talks to Claude and ElevenLabs. **Aldous's personality and the trust stages are at the top of this file.**
- `netlify.toml` : tells Netlify where things are

## Netlify environment variables

Site configuration > Environment variables:

| Name | Value | Needed? |
|---|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key | Yes |
| `GAME_PASSCODE` | any word you pick | Strongly recommended |
| `ELEVENLABS_API_KEY` | your ElevenLabs key | For his real voice and voice input |
| `ELEVENLABS_VOICE_ID` | the voice ID you choose | For his real voice |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-5-5` | Optional, default `claude-haiku-5-5` |

Redeploy after changing variables.

## Controls

- Quest: hold the trigger to speak, release to send. Once he tells you the secret, point at the glowing stone and pull the trigger.
- Desktop: hold Space or the button to speak, or type. Drag to look. Press T (or add `?debug` to the URL) to see the trust score.
