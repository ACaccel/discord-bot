# Discord Bot

A discord bot based on discord.js library. You can customize it by adding your own commands, bots, and features.

## Content

- [Features](#features)
- [Usage](#usage)
- [Configuration](#configuration)
- [License](#license)

## Features

- Slash Command Handling: Defines commands in the config file and their handlers under the `commands/slash_command.ts` file.
- Event Listening: Listens to Discord events such as message creations/deletions/updates, guild member updates, and interactions.
- Message Auto-Reply: Replies to guild members' messages with a predefined message reply pair recorded in the MongoDB database.
- Message Backup: Fetches messages from Discord channels and stores them in a MongoDB database for backup purposes.

## Usage

After cloning the repository, you should put your own `config.json` and `.env` files in the bot directory.

```bash
git clone https://github.com/ACaccel/discord-bot.git
cd discord-bot
yarn install
yarn <bot-name>
```

## Configuration

The `config.json` file contains the bot's configuration settings. You can customize the bot's settings by modifying this example.

- `guilds`: An array of guilds that the bot is in. Each guild has its own `channels` and `roles` objects. You can define any channel and role that you want to access in the code.
- `identities`: Customize the bot's identity, including name, avatar, and color role.
- `commands`: Define your slash commands here. Each command has a `name`, `description`, and `options(optional)` fields. The `options` defines the command's parameters. There are 5 types of parameters: `user`, `channel`, `string`, `number`, and `attachment`. Each type contains `name`, `description`, `required`, and `choices(optional)` fields.

```json
{
  {
    "guilds": [
        {
            "guild_id": "your-guild-id",
            "channels": {
                "debug": "debug-channel-id",
            },
            "roles": {
                "admin": "admin-role-id",
            }
        }
    ],
    "identities": {
        "bot-name": {
            "avator_url": "https://example.com/avator.png",
            "color_role": "green"
        }
    },
    "commands": [
        {
            "name": "help",
            "description": "list all commands and their descriptions"
        },{
            "name": "change_avatar",
            "description": "change the bot's avatar",
            "options": {
                "string": [
                    {
                        "name": "identity",
                        "description": "the bot's identity",
                        "required": true,
                        "choices": [
                            { "name": "bot-name", "value": "bot-name" },
                        ]
                    }
                ]
            }
        }
    ],
  }
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