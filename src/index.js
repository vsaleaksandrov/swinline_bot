require('dotenv').config({ path: ".env" });
const { MongoClient, ServerApiVersion } = require('mongodb');
const { io } = require("socket.io-client");
const { Bot, session, InlineKeyboard,  } = require("grammy");
const { hydrate } = require("@grammyjs/hydrate");
const {
    conversations,
    createConversation,
} = require("@grammyjs/conversations");
const express = require('express');

const { BOT_TOKEN, USER_ID, CLIENT_PORT, SERVER_PORT, DB_LOGIN, DB_PASS   } = process.env;

let LAST_GAMES = null,
    LAST_GAMES_ACTIVE_INDEX = 0,
    CURRENT_GAME_INFO = null;

const mongoDbUri = `mongodb+srv://${DB_LOGIN}:${DB_PASS}@cluster0.j9yo8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
let dbClient = null;
mongoDbStartServer().then(res => dbClient = res).catch(console.dir);

async function mongoDbStartServer () {
    try {
        const client = new MongoClient(mongoDbUri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        return client;
    } catch (error) {
        console.error(error);
    }
}

// Запускаем бота, работяги
const bot = new Bot(BOT_TOKEN);
bot.use(hydrate());
bot.use(session({
    initial() {
        return {};
    },
}));

bot.use(conversations());
bot.use(createConversation(weaksideDialogue));
bot.use(createConversation(betSum));
bot.start();

// Запускаем сервер
const app = express();
app.use(express.json());
app.listen(CLIENT_PORT);

const SERVER_URI = `http://localhost:${SERVER_PORT}`;
const socket = io(SERVER_URI);

bot.api.setMyCommands([
    {
        command: "start",
        description: "Weakside_bot"
    }
])

const getGameById = async (gameId) => await fetch(`${SERVER_URI}/getGameById/${gameId}`);

const getLastGames = async () => await fetch(`${SERVER_URI}/getLastGames`).then(res => res.json());

async function weaksideDialogue(conversation, ctx) {
    const { message } = await conversation.wait();

    if (!message) return;

    const SETTINGS_COLLECTION = await getDBSettingsCollection();

    if (message.text.indexOf('RGAPI') !== -1) {
        await SETTINGS_COLLECTION.updateOne({ TWITCH_ID: "GENERAL_HS_" }, { "$set": { RIOT_API_KEY: message.text } } );

        await ctx.reply(`RIOT_API_KEY обновлён. Текущее значение ${message.text}`, {
            reply_markup: adminKeyboard,
        });
    } else {
        await SETTINGS_COLLECTION.updateOne({ TWITCH_ID: "GENERAL_HS_" }, { "$set": { SUMMONER: message.text } } );

        await ctx.reply(`SUMMONER_NAME#SUMMONER_ID обновлён. Текущее значение ${message.text}`, {
            reply_markup: adminKeyboard,
        });
    }

    await conversation.exit;
}

const menuKeyboard = new InlineKeyboard()
    .text("Статистика ставок", "balance-stat")
    .text("Последние игры", "history-list")
    .row()
    .text("Сделать ставку на игру", "set-bet")

const betKeyboard = new InlineKeyboard()
    .text("Победа", "bet-win")
    .text("Луз", "bet-lost")
    .text("КДА", "bet-kda")
    .text("Фарм", "bet-farm")
    .row()
    .text("Назад", "back")

const submitKeyboard = new InlineKeyboard()
    .text("Понятно", "okay")


const adminKeyboard = new InlineKeyboard()
    .text("Обновить RIOT_API_KEY", "update_riot_api_key").row()
    .text("Обновить SUMMONER_NAME#SUMMONER_ID", "update_summoner_info")


const getDBSettingsCollection = async () => {
    const KEGLYA_DB = await dbClient.db("keglya_db");
    return await KEGLYA_DB.collection("settings");
}

const getDBUsersCollection = async () => {
    const KEGLYA_DB = await dbClient.db("keglya_db");
    return await KEGLYA_DB.collection("users");
}

const getDBInfo = async () => {
    const SETTINGS_COLLECTION = await getDBSettingsCollection();
    return await SETTINGS_COLLECTION.findOne({ TWITCH_ID: "GENERAL_HS_"});
}

bot.callbackQuery("update_riot_api_key", async (ctx) => {
    const INFO = await getDBInfo();
    await ctx.reply(`Текущий RIOT_API_KEY - ${INFO.RIOT_API_KEY}. Отправьте сообщение с новым значением.`)
    await ctx.conversation.enter("weaksideDialogue")
});

bot.callbackQuery("update_summoner_info", async (ctx) => {
    const INFO = await getDBInfo();
    await ctx.reply(`Текущий SUMMONER - ${INFO.SUMMONER}. Отправьте сообщение с новым значением.`)
    await ctx.conversation.enter("weaksideDialogue")
});


const INTRO_MESSAGE = `
Здесь можно делать ставки на игры стримера General_HS_ по League of Legends
\nСтавки делаются исключительно на игровую валюту. Никакого вывода или пополнения не предусмотрено.
\nБот автоматически предложит вам сделать ставку как только General_HS_ начнёт игру. После того как игра закончится - бот рассчитает ставку и выплатит выигрыш.
`

let IS_PLAYING_RIGHT_NOW = true;
let IS_READY_TO_BET = false;
let IS_ADMIN = false;

let CURRENT_BET_TYPE = null;
let CURRENT_BET = [{
    type: "WIN",
    sum: null,
}, {
    type: "LOST",
    sum: null,
}, {
    type: "KDA",
    count: 0,
    sum: null,
}, {
    type: "FARM",
    count: 0,
    sum: null,
}];

function isNumeric(str) {
    if (typeof str != "string") return false // we only process strings!
    return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
        !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
}

async function betSum(conversation, ctx) {
    const userId = ctx.update.callback_query.from.id;
    const USERS_COLLECTION = await getDBUsersCollection();
    let uniqueUser = await USERS_COLLECTION.findOne({ name: userId });

    let answer = await conversation.wait();
    if (!answer.message) return;

    if (!isNumeric(answer.message.text)) {
        await ctx.reply(`Укажите корректное значение ставки.`)
        return;
    }

    if (CURRENT_BET.find(() => CURRENT_BET_TYPE === "FARM" || CURRENT_BET_TYPE === "KDA")) {
        CURRENT_BET = CURRENT_BET.map(bet => {
            if (bet.type === CURRENT_BET_TYPE) {
                return {
                    ...bet,
                    count: answer.message.text,
                }
            }

            return bet;
        });

        await ctx.reply(`Укажите сумму ставки`)
        answer = await conversation.wait()

        if (!isNumeric(answer.message.text)) {
            await ctx.reply(`Укажите корректную сумму ставки.`)
            return;
        }

        if (answer.message.text > uniqueUser.balance) {
            await ctx.reply(`Ваш баланс ${uniqueUser.balance}. Укажите корректную сумму ставки.`)
            return;
        }
    }

    CURRENT_BET = CURRENT_BET.map(bet => {
        if (bet.type === CURRENT_BET_TYPE) {
            return {
                ...bet,
                sum: answer.message.text,
            }
        }

        return bet;
    });

    // TODO здесь нужно будет отправить на бэк обновлённый массив CURRENT_BET

    await ctx.reply(`
Ваша ставка ${CURRENT_BET_TYPE} в размере ${answer.message.text} принята. 
`, {
        reply_markup: betKeyboard,
    })

    await conversation.exit;
}

async function updateCurrentBet(ctx) {
    const currentBetSum = CURRENT_BET.find(bet => bet.type === CURRENT_BET_TYPE).sum;

    if (currentBetSum) {
        await ctx.callbackQuery.message.editText(`
Ваша ставка ${CURRENT_BET_TYPE} в размере ${currentBetSum} уже принята. 
`, {
            reply_markup: betKeyboard,
        })
        return;
    }

    if (CURRENT_BET.find(() => CURRENT_BET_TYPE === "FARM" || CURRENT_BET_TYPE === "KDA")) {
        await ctx.reply(`Укажите значение`)
    } else {
        await ctx.reply(`Укажите сумму ставки`)
    }

    await ctx.conversation.enter("betSum")
}

bot.callbackQuery("bet-win", async (ctx) => {
    CURRENT_BET_TYPE = "WIN";
    await updateCurrentBet(ctx)
});

bot.callbackQuery("bet-lost", async (ctx) => {
    CURRENT_BET_TYPE = "LOST";
    await updateCurrentBet(ctx)
});

bot.callbackQuery("bet-kda", async (ctx) => {
    CURRENT_BET_TYPE = "KDA";
    await updateCurrentBet(ctx)
});

bot.callbackQuery("bet-farm", async (ctx) => {
    CURRENT_BET_TYPE = "FARM";
    await updateCurrentBet(ctx)
});

bot.command("start_admin", async (ctx) => {
    IS_ADMIN = `${ctx.message.chat.id}` === USER_ID;

    if (!IS_ADMIN) return;

    await ctx.reply(`Это админская панель. Здесь можно обновить данные для активного игрока.`, {
        reply_markup: adminKeyboard,
    })
});

bot.command("start", async (ctx) => {
    socket.on('currentGame', async function (currentGame) {
        if (currentGame) {
            IS_PLAYING_RIGHT_NOW = true;
            IS_READY_TO_BET = currentGame.gameLength < 50;

            if (!CURRENT_GAME_INFO && IS_READY_TO_BET) {
                CURRENT_GAME_INFO = currentGame;
                await ctx.reply("Игра началась. Ставки открыты", {
                    reply_markup: betKeyboard,
                });
            }
            return;
        }

        IS_PLAYING_RIGHT_NOW = false;

        if (CURRENT_GAME_INFO) {
            await ctx.reply("Игра окончена", {
                reply_markup: submitKeyboard,
            });

            CURRENT_GAME_INFO = null;
        }
    });

    await ctx.reply(INTRO_MESSAGE, {
        reply_markup: submitKeyboard,
    })
});

bot.callbackQuery("back", async (ctx) => {
    await ctx.callbackQuery.message.editText(INTRO_MESSAGE, {
        reply_markup: menuKeyboard,
    })
})

bot.callbackQuery("set-bet", async (ctx) => {
    if (IS_PLAYING_RIGHT_NOW && IS_READY_TO_BET) {
        await ctx.callbackQuery.message.editText(`Игра началась. Ставки открыты`, { reply_markup: new betKeyboard()
                .text("Назад", "back")
        });
    }

    if (IS_PLAYING_RIGHT_NOW && !IS_READY_TO_BET) {
        await ctx.callbackQuery.message.editText(`Окно ставок закрыто. Пожалуйста, дождитесь начала следующей игры.`, { reply_markup: new InlineKeyboard()
                .text("Назад", "back")
        });
    }

    if (!IS_PLAYING_RIGHT_NOW) {
        await ctx.callbackQuery.message.editText(`В данный момент General_HS_ не играет.`, { reply_markup: new InlineKeyboard()
                .text("Назад", "back")
        });
    }
})


bot.callbackQuery("okay", async (ctx) => {
    await ctx.callbackQuery.message.editText(INTRO_MESSAGE, {
        reply_markup: menuKeyboard,
    })
}) 

bot.callbackQuery("balance-stat", async (ctx) => {
    const USERS_COLLECTION = await getDBUsersCollection();

    const userId = ctx.update.callback_query.from.id;
    let uniqueUser = await USERS_COLLECTION.findOne({ name: userId });

    if (!uniqueUser?.name) {
        uniqueUser = {
            name: userId,
            balance: 150000,
            successBets: 0,
            totalBets: 0,
            activeBets: [],
        }

        await USERS_COLLECTION.insertOne(uniqueUser)
    }

    const { balance, successBets, totalBets } = uniqueUser;

    await ctx.callbackQuery.message.editText(`
    Статистика:
Бетов на счету: ${balance}
Успешных ставок: ${successBets}
Ставок всего: ${totalBets}
`, { reply_markup: new InlineKeyboard()
            .text("Назад", "back")
    });
    await ctx.answerCallbackQuery()
})


const statsKeyboard = new InlineKeyboard()
    .text("<", "prev-game")
    .text(">", "next-game")
    .row()
    .text("Назад", "back")

bot.callbackQuery("history-list", async (ctx) => {
    LAST_GAMES = await getLastGames();

    const gameInfo = await getGameById(LAST_GAMES[LAST_GAMES_ACTIVE_INDEX]).then(res => res.text());
    await ctx.callbackQuery.message.editText(`${gameInfo}`, { reply_markup: new InlineKeyboard()
            .text("<", "prev-game")
            .row()
            .text("Назад", "back") });
    await ctx.answerCallbackQuery()
})

bot.callbackQuery("prev-game", async (ctx) => {
    if (LAST_GAMES_ACTIVE_INDEX >= 4) return;

    LAST_GAMES_ACTIVE_INDEX++;

    const gameInfo = await getGameById(LAST_GAMES[LAST_GAMES_ACTIVE_INDEX]).then(res => res.text());
    await ctx.callbackQuery.message.editText(`${gameInfo}`, {
        reply_markup: LAST_GAMES_ACTIVE_INDEX > 3 ? new InlineKeyboard()
        .text(">", "next-game")
        .row()
        .text("Назад", "back")
    : statsKeyboard });
    await ctx.answerCallbackQuery()
})

bot.callbackQuery("next-game", async (ctx) => {
    if (LAST_GAMES_ACTIVE_INDEX <= 0) return;

    LAST_GAMES_ACTIVE_INDEX--;

    const gameInfo = await getGameById(LAST_GAMES[LAST_GAMES_ACTIVE_INDEX]).then(res => res.text());
    await ctx.callbackQuery.message.editText(`${gameInfo}`, {
        reply_markup: LAST_GAMES_ACTIVE_INDEX < 1 ? new InlineKeyboard()
                .text("<", "prev-game")
                .row()
                .text("Назад", "back")
            : statsKeyboard });
    await ctx.answerCallbackQuery()
})