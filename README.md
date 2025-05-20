# Discord Bot

A discord bot based on discord.js library. You can customize it by adding your own commands, bots, and features.

## Content

- [Discord Bot](#discord-bot)
  - [Content](#content)
  - [Features](#features)
  - [Usage](#usage)
  - [Configuration](#configuration)
  - [License](#license)

## Features

- Multiple Built-in Commands: There are some built-in commands defined under the `commands/` directory. You can also create your own commands.
- Event Listening: Listen to Discord events such as message creations/deletions/updates, message reactions, guild member updates, and interactions.
- Message Auto-Reply: Replies to guild members' messages with a predefined message reply pair recorded in the MongoDB database.
- Message Backup: Fetches messages from Discord channels and stores them in a MongoDB database for the backup purpose.

## Usage

After cloning the repository, you should put your own `config.json` and `.env` files in the bot directory.

```bash
git clone https://github.com/ACaccel/discord-bot.git
cd discord-bot
yarn install
yarn <bot-name>

# for voice record command
sudo apt install ffmpeg
```

## Configuration

The `config.json` file contains the bot's configuration settings. You can customize the bot's settings by modifying this example.

- `guilds`: Guilds that the bot has joined. Each guild has its own `channels` and `roles` objects. You can define any channel and role that you want to access in the code.
- `commands`: Define the commands that the bot will respond to. Remember to add the command name here if you create a new one.

```json
{
    "admin": "671160708007854120",
    "guilds": {
        "your-guild-id": {
            "channels": {
                "debug": "debug-channel-id",
            },
            "roles": {
                "admin": "admin-role-id",
            }
        },
        ...
    },
    "commands": [
        "help",
        "bug_report",
        "change_avatar",
        "talk",
        ...
    ],
    other custom configurations...
}
```

The `.env` file contains the bot's environment variables. It should have the following variables.

```env
TOKEN = YOUR_DISCORD_BOT_TOKEN
MONGO_URI = YOUR_MONGODB_URI
CLIENT_ID = YOUR_DISCORD_BOT_CLIENT_ID
PORT = LISTENING_PORT (if you want to run the bot as a web server)
```

## License

The project is licensed under the MIT license - see the [LICENSE](LICENSE) file for details.
