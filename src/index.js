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
}

const { BOT_TOKEN, SUMMONER_NAME , SUMMONER_ID , PORT, DOMAIN, RIOT_API_KEY   } = process.env;

const bot = new Bot(BOT_TOKEN);
bot.use(hydrate());

const getLastGameInfo = async () => await db.get("LAST_GAME_INFO");

bot.api.setMyCommands([
    {
        command: "start",
        description: "Бот самой честной и бесполезной букмекерской конторы СВИНЛАЙН."
    }
])

const menuKeyboard = new InlineKeyboard()
    .text("Статистика ставок", "balance-stat")
    .text("Статистика последних игр", "history-list")

bot.command("start", async (ctx) => {
    await ctx.reply(`
    СВИНЛАЙН 🐷 - самый честный и бесполезный букмекер
\nЗдесь можно делать ставки на игры стримера General_HS_ по League of Legends
\nСтавки делаются исключительно на игровую валюту - свинбеты. Никакого вывода или пополнения не предусмотрено.
\nБот автоматически предложит вам сделать ставку как только General_HS_ начнёт игру. После того как игра закончится - бот рассчитает ставку и выплатит выигрыш.
`, {
        reply_markup: menuKeyboard,
    })
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

const domain = String(DOMAIN);
const secretPath = String(BOT_TOKEN);

const app = express();
app.use(express.json());
app.use(`/${secretPath}`, webhookCallback(bot, "express"));

app.listen(Number(PORT), async () => {
    updateUserInfo().catch(error => console.log(error))
    await bot.api.setWebhook(`https://${domain}/${secretPath}`);
});

bot.start();

const updateUserInfo = async function(){
    const responseUser = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER_NAME}/${SUMMONER_ID}?api_key=${RIOT_API_KEY}`)
        .then(res => res.json())

    const PUUID = responseUser.puuid;

    return new Promise((done, reject) => {
        setInterval(async () => {
            try {
                const lastGames = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${PUUID}/ids?start=0&count=5&api_key=${RIOT_API_KEY}`)
                    .then(res => res.json())

                const lastGameStats = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${lastGames[0]}?api_key=${RIOT_API_KEY}`).then(res => res.json());

                if (lastGameStats.info.endOfGameResult !== "GameComplete") {
                    console.log("Игра идёт");
                } else {
                    console.log("Сейчас нет игр")
                }

                const playerStat = lastGameStats.info.participants.find(player => {
                    return player.puuid === PUUID
                });

                done({
                    championName: playerStat.championName,
                    kda: playerStat.challenges.kda,
                    role: playerStat.lane,
                    name: playerStat.riotIdGameName,
                    win: playerStat.win,
                    kills: playerStat.kills,
                    deaths: playerStat.deaths,
                    assists: playerStat.assists,
                    minions: playerStat.totalMinionsKilled + playerStat.neutralMinionsKilled,
                });
            } catch (e) {
                reject();
            }
        }, 1000 * 60);
    });
}