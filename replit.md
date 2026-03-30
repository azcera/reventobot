# Revento Discord Bot

A Discord bot built with `discord.js` that automates server management tasks — specifically creating and managing archive channels for users.

## Tech Stack

- **Runtime:** Node.js
- **Discord Library:** discord.js v14
- **Web Server:** Express (keep-alive on port 3000)
- **Environment:** dotenv

## Project Structure

- `index.js` — Entry point; initializes Discord client, loads events/commands, starts Express server
- `commands/` — Slash and prefix commands (e.g. `/pack`, `!navigation`, `!narchive`)
- `events/` — Event handlers (message, role update, button interactions, channel creation)
- `config.json` — Static config (admin roles, navigation button links)

## Running the App

```bash
node index.js
```

Workflow: **Start application** → `node index.js` (console, port 3000)

## Environment Variables

Required in `.env`:
- `TOKEN` — Discord bot token
- `CLIENT_ID` — Discord application client ID
- `GUILD_ID` — Target guild/server ID
- `MENTIONED_ROLE` — Role ID to mention in notifications
- `CATEGORY_ID` — Category ID for archive channels
- `AUTO_ROLE` — Role ID that triggers automatic archive creation
- `MESSAGES_CHANNEL_ID` — Channel ID for admin prompts

## Dependency Notes

- `undici` is overridden to `^6.24.0` in `package.json` via the `overrides` field to address a security vulnerability (CVE affecting undici <6.24.0).
