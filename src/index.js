require('dotenv').config();
const { Bot, InlineKeyboard, webhookCallback } = require("grammy");
const { hydrate } = require("@grammyjs/hydrate");
const express = require('express');
const JSONdb = require('simple-json-db');
const db = new JSONdb('./src/db.json');

const INITIAL_STAT = {
    bets: 10000,
    successBetCount: 0,
    totalBets: 0,
    activeBet: null
}

const { BOT_TOKEN, SUMMONER_NAME , SUMMONER_ID , PORT, DOMAIN, RIOT_API_KEY   } = process.env;

const bot = new Bot(BOT_TOKEN);

bot.use(hydrate());

const getLastGameInfo = async () => {
    const responseUser = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER_NAME}/${SUMMONER_ID}?api_key=${RIOT_API_KEY}`)
        .then(res => res.json())

    const PUUID = responseUser.puuid;
    const lastGames = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${PUUID}/ids?start=0&count=5&api_key=${RIOT_API_KEY}`)
        .then(res => res.json())

    const lastGameStats = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${lastGames[0]}?api_key=${RIOT_API_KEY}`).then(res => res.json());

    const playerStat = lastGameStats.info.participants.find(player => {
        return player.puuid === PUUID
    });

    return {
        championName: playerStat.championName,
        kda: playerStat.challenges.kda,
        role: playerStat.lane,
        name: playerStat.riotIdGameName,
        win: playerStat.win,
        kills: playerStat.kills,
        deaths: playerStat.deaths,
        assists: playerStat.assists,
        minions: playerStat.totalMinionsKilled + playerStat.neutralMinionsKilled,
    };
}

bot.api.setMyCommands([
    {
        command: "start",
        description: "Бот самой честной и бесполезной букмекерской конторы СВИНЛАЙН."
    }
])

const menuKeyboard = new InlineKeyboard()
    .text("Статистика ставок", "balance-stat")
    .text("Статистика последних игр", "history-list")
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
    await ctx.reply(INTRO_MESSAGE, {
        reply_markup: submitKeyboard,
    })
});

bot.callbackQuery("win", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;
    const users = await db.get("USERS");

    let user = users.find(user => user.id === userId);

    user = {
        ...INITIAL_STAT,
        activeBet: {
            status: "WIN",
        }
    }

    await db.set("USERS", [...users, user]);

    await ctx.callbackQuery.message.editText(`
Ваша ставка WIN принята. 
\nЕсли ставка окажется верна - вам начислится 1000 свинбетов.
`, {
        reply_markup: menuKeyboard,
    })
})

bot.callbackQuery("lost", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;
    const users = await db.get("USERS");

    let user = users.find(user => user.id === userId);

    user = {
        ...INITIAL_STAT,
        activeBet: "LOST"
    }

    await db.set("USERS", [...users, user]);

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
    if (!IS_PLAYING_RIGHT_NOW) {
        await ctx.callbackQuery.message.editText(`В данный момент игра не запущена. Ставка невозможна.`, { reply_markup: menuKeyboard });
        return;
    }

    if (!SECONDS_LEFT) {
        await ctx.callbackQuery.message.editText(`В данный момент игра запущена. Время ставок прошло.`, { reply_markup: menuKeyboard });
        return;
    }

    await ctx.callbackQuery.message.editText(`Сделайте ставку. До конца приёма ставок осталось ${SECONDS_LEFT} секунд`, { reply_markup: betKeyboard });
})


bot.callbackQuery("okay", async (ctx) => {
    await ctx.callbackQuery.message.editText(INTRO_MESSAGE, {
        reply_markup: menuKeyboard,
    })

    setInterval(async () => {
        try {
            const CURRENT_GAME = await getCurrentGame();

            if (!CURRENT_GAME.id) {
                await ctx.callbackQuery.message.editText(INTRO_MESSAGE, {
                    reply_markup: menuKeyboard,
                })

                IS_PLAYING_RIGHT_NOW = false;

                const userId = ctx.update.callback_query.from.id;
                const users = await db.get("USERS");

                let user = users.find(user => user.id === userId);

                if (user.activeBet) {
                    user = {
                        ...INITIAL_STAT,
                        id: userId,
                    }

                    await db.set("USERS", [...users, user]);
                }

                return;
            }

            const minutes = Math.floor(CURRENT_GAME.gameLength / 60)
            await ctx.callbackQuery.message.editText(`
В данный момент General_HS_ керрит катку.
\nИгра длится ${minutes} минут`, {
                reply_markup: menuKeyboard,
            })

            if (CURRENT_GAME.gameLength < 1000) {
                SECONDS_LEFT = 1000 - CURRENT_GAME.gameLength;
            } else {
                SECONDS_LEFT = 0;
            }

            IS_PLAYING_RIGHT_NOW = true;
        } catch (e) {
            console.log(e)
        }
    }, 10000);
})

bot.callbackQuery("balance-stat", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;
    const users = await db.get("USERS");

    let user = users.find(user => user.id === userId);

    if (!user) {
        user = {
            ...INITIAL_STAT,
            id: userId,
        }

        await db.set("USERS", [...users, user]);
    }

    const { bets, successBetCount, totalBets } = user;

    await ctx.callbackQuery.message.editText(`
    Статистика:
Свинбетов на счету: ${bets}
Успешных ставок: ${successBetCount}
Ставок всего: ${totalBets}
`, { reply_markup: menuKeyboard });
    await ctx.answerCallbackQuery()
})

bot.callbackQuery("history-list", async (ctx) => {
    const { name, championName, kda, win, kills, deaths, assists, minions, role } = await getLastGameInfo();
    await ctx.callbackQuery.message.editText(
        `Последняя игра: ${name}
Чемпион: ${championName}
Играл на позиции: ${role}
Результат: ${win ? "Победа ✅" : "Поражение ❌"}
Убийств: ${kills}, Смертей: ${deaths}, Ассистов: ${assists}
Итоговый КДА: ${kda}
Фарм: ${minions}`, { reply_markup: menuKeyboard });
    await ctx.answerCallbackQuery()
})

const app = express();
app.use(express.json());

const port = PORT || 3002;
app.listen(port);

bot.start();

const getCurrentGame = async function(){
    const responseUser = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER_NAME}/${SUMMONER_ID}?api_key=${RIOT_API_KEY}`)
        .then(res => res.json())

    const PUUID = responseUser.puuid;
    const currentGame = await fetch(`https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${PUUID}?api_key=${RIOT_API_KEY}`)
        .then(res => res.json())

    return {
        id: currentGame.gameId,
        gameLength: currentGame.gameLength, // сколько длится игра
    };
}