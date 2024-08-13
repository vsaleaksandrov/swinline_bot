require('dotenv').config({ path: ".env" });
const { MongoClient, ServerApiVersion } = require('mongodb');
const { io } = require("socket.io-client");
const { Bot, InlineKeyboard } = require("grammy");
const { hydrate } = require("@grammyjs/hydrate");
const express = require('express');

const { BOT_TOKEN, SUMMONER_NAME , SUMMONER_ID , CLIENT_PORT, RIOT_API_KEY, SERVER_PORT, DB_LOGIN, DB_PASS   } = process.env;

const INITIAL_STAT = {
    bets: 150000,
    successBetCount: 0,
    totalBets: 0,
    activeBet: null
}

let LAST_GAMES = null,
    LAST_GAMES_ACTIVE_INDEX = 0;

const uri = `mongodb+srv://${DB_LOGIN}:${DB_PASS}@cluster0.j9yo8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
let dbClient = null;
run().then(res => dbClient = res).catch(console.dir);

async function run () {
    try {
        const client = new MongoClient(uri, {
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

const updateLastGames = async function() {
    try {
        const responseUser = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER_NAME}/${SUMMONER_ID}?api_key=${RIOT_API_KEY}`)
            .then(res => res.json())

        const PUUID = responseUser.puuid;

        if (!PUUID) {
            throw new Error('Ошибка. Необходимо обновить RIOT_API_KEY.');
        }

        return await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${PUUID}/ids?start=0&count=5&api_key=${RIOT_API_KEY}`)
            .then(res => res.json());
    } catch (error) {
        console.log(error);
    }
}

// Запускаем бота, работяги
const bot = new Bot(BOT_TOKEN);
bot.use(hydrate());
bot.start();

// Запускаем сервер
const app = express();
app.use(express.json());
app.listen(CLIENT_PORT);

const socket = io(`http://localhost:${SERVER_PORT}`);

bot.api.setMyCommands([
    {
        command: "start",
        description: "Бот самой честной и бесполезной букмекерской конторы СВИНЛАЙН."
    }
])

const menuKeyboard = new InlineKeyboard()
    .text("Статистика ставок", "balance-stat")
    .text("Последние игры", "history-list")
    .row()
    .text("Сделать ставку на игру", "set-bet")

const betKeyboard = new InlineKeyboard()
    .text("Win", "bet-win")
    .text("Lost", "bet-lost")
    .row()
    .text("Назад", "back")

const submitKeyboard = new InlineKeyboard()
    .text("Я понял", "okay")

const INTRO_MESSAGE = `
СВИНЛАЙН 🐷 - самый честный и бесполезный букмекер
\nЗдесь можно делать ставки на игры стримера General_HS_ по League of Legends
\nСтавки делаются исключительно на игровую валюту - свинбеты. Никакого вывода или пополнения не предусмотрено.
\nБот автоматически предложит вам сделать ставку как только General_HS_ начнёт игру. После того как игра закончится - бот рассчитает ставку и выплатит выигрыш.
`

let IS_PLAYING_RIGHT_NOW = false;
let SECONDS_LEFT = 0;

bot.command("start", async (ctx) => {
    socket.on('currentGame', async function (currentGame) {
        if (currentGame) {
            IS_PLAYING_RIGHT_NOW = true;
            return;
        }

        IS_PLAYING_RIGHT_NOW = false;
    });

    await ctx.reply(INTRO_MESSAGE, {
        reply_markup: submitKeyboard,
    })
});

bot.callbackQuery("win", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;

    await ctx.callbackQuery.message.editText(`
Ваша ставка WIN принята. 
\nЕсли ставка окажется верна - вам начислится 1000 свинбетов.
`, {
        reply_markup: menuKeyboard,
    })
})

bot.callbackQuery("lost", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;

    await ctx.callbackQuery.message.editText(`
Ваша ставка LOST принята.
\nЕсли General_HS_ победит - вам начислится 1000 свинбетов.
`, {
        reply_markup: menuKeyboard,
    })
})

bot.callbackQuery("back", async (ctx) => {
    await ctx.callbackQuery.message.editText(INTRO_MESSAGE, {
        reply_markup: menuKeyboard,
    })
})

bot.callbackQuery("set-bet", async (ctx) => {
    if (IS_PLAYING_RIGHT_NOW) {
        await ctx.callbackQuery.message.editText(`Окно ставок закрыто. Пожалуйста, дождитесь результата игры.`, { reply_markup: menuKeyboard });
    }

    // if (!SECONDS_LEFT) {
    //     await ctx.callbackQuery.message.editText(`В данный момент игра запущена. Время ставок прошло.`, { reply_markup: menuKeyboard });
    //     return;
    // }
    //
    // await ctx.callbackQuery.message.editText(`Сделайте ставку. До конца приёма ставок осталось ${SECONDS_LEFT} секунд`, { reply_markup: betKeyboard });
})


bot.callbackQuery("okay", async (ctx) => {
    await ctx.callbackQuery.message.editText(INTRO_MESSAGE, {
        reply_markup: menuKeyboard,
    })
}) 

bot.callbackQuery("balance-stat", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;

    const { bets, successBetCount, totalBets } = user;

    await ctx.callbackQuery.message.editText(`
    Статистика:
Свинбетов на счету: ${bets}
Успешных ставок: ${successBetCount}
Ставок всего: ${totalBets}
`, { reply_markup: menuKeyboard });
    await ctx.answerCallbackQuery()
})


const statsKeyboard = new InlineKeyboard()
    .text("<", "prev-game")
    .text(">", "next-game")
    .row()
    .text("Назад", "back")

bot.callbackQuery("history-list", async (ctx) => {
    LAST_GAMES = await updateLastGames();

    await ctx.callbackQuery.message.editText(`${LAST_GAMES[0]}`, { reply_markup: new InlineKeyboard()
            .text("<", "prev-game")
            .row()
            .text("Назад", "back") });
    await ctx.answerCallbackQuery()
})

bot.callbackQuery("prev-game", async (ctx) => {
    if (LAST_GAMES_ACTIVE_INDEX >= 4) return;

    LAST_GAMES_ACTIVE_INDEX++;

    await ctx.callbackQuery.message.editText(`${LAST_GAMES[LAST_GAMES_ACTIVE_INDEX]}`, {
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
    await ctx.callbackQuery.message.editText(`${LAST_GAMES[LAST_GAMES_ACTIVE_INDEX]}`, {
        reply_markup: LAST_GAMES_ACTIVE_INDEX < 1 ? new InlineKeyboard()
                .text("<", "prev-game")
                .row()
                .text("Назад", "back")
            : statsKeyboard });
    await ctx.answerCallbackQuery()
})