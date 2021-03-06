function playerinfo_embed(player, od_heroes) {
    let winrate = (player.wl.win / (player.wl.win + player.wl.lose));
    winrate = winrate * 10000;
    winrate = Math.round(winrate);
    winrate = winrate / 100;

    let countrycode = player.profile.loccountrycode || "Unknown";
    let flag = countrycode == "Unknown" ? "" : `:flag_${countrycode.toLowerCase()}:`;

    let mmr_display = [];
    let mmr = [];

    if (player.solo_competitive_rank) {
        mmr_display.push("solo");
        mmr.push(player.solo_competitive_rank);
    }

    if (player.competitive_rank) {
        mmr_display.push("party");
        mmr.push(player.competitive_rank);
    }

    if (player.mmr_estimate.estimate) {
        mmr_display.push("est.");
        mmr.push(player.mmr_estimate.estimate);
    }

    if (mmr.length < 1) {
        mmr.push("No mmr data found.");
    }

    let display_heroes = [];
    player.heroes = player.heroes.slice(0, 5);
    for (let hero in player.heroes) {
        let local_name = od_heroes.find(od_hero => od_hero.id == player.heroes[hero].hero_id).localized_name;
        let winrate = (player.heroes[hero].win / player.heroes[hero].games);
        winrate = winrate * 10000;
        winrate = Math.round(winrate);
        winrate = winrate / 100;
        display_heroes.push(`(${winrate}% with ${player.heroes[hero].games} games) **${local_name}**`);
    }

    let dotabuff_link = `https://www.dotabuff.com/players/${player.profile.account_id}`;
    let opendota_link = `https://www.opendota.com/players/${player.profile.account_id}`;

    return {
        "title": `Player Stats for ${player.profile.personaname}`,
        "fields": [{
            "name": `MMR: ${mmr_display.join(" / ")}`,
            "value": mmr.join(" / "),
            "inline": true
        }, {
            "name": "Wins/Losses",
            "value": `${player.wl.win}/${player.wl.lose} (${winrate}%)`,
            "inline": true
        }, {
            "name": "Country",
            "value": `${flag} ${countrycode}`,
            "inline": true
        }, {
            "name": "Links",
            "value": `[DB](${dotabuff_link}) / [OD](${opendota_link}) / [Steam](${player.profile.profileurl})`,
            "inline": true
        }, {
            "name": "Top 5 Heroes",
            "value": display_heroes.join("\n"),
            "inline": false
        }],
        "thumbnail": {
            "url": player.profile.avatarfull
        }
    };
}

async function send_message(message, client, helper, acc_id) {
    helper.log(message, `playerinfo: ${acc_id}`);

    try {
        await message.channel.sendTyping();
    } catch (err) {
        helper.handle(message, err);
    }

    client.redis.get(`playerinfo:${acc_id}`, (err, reply) => {
        if (err) helper.log(message, err);
        if (reply) {
            message.channel.createMessage({
                embed: playerinfo_embed(JSON.parse(reply), client.core.json.od_heroes)
            }).then(() => {
                helper.log(message, "  sent player info from redis");
            }).catch(err => helper.handle(message, err));
        } else {
            Promise.all([
                client.mika.getPlayer(acc_id),
                client.mika.getPlayerWL(acc_id),
                client.mika.getPlayerHeroes(acc_id)
            ]).then((plist) => {
                plist[0].wl = plist[1];
                plist[0].heroes = plist[2];

                if (!plist[0].profile) {
                    message.channel.createMessage("This user's account is private. ").catch(err => helper.handle(message, err));
                    return;
                }

                message.channel.createMessage({
                    embed: playerinfo_embed(plist[0], client.core.json.od_heroes)
                }).then(() => {
                    helper.log(message, "  sent player info from api");

                    client.pg.query({
                        "text": "UPDATE public.users SET scr = $1, cr = $2, sat = $3 WHERE dotaid = $4;",
                        "values": [plist[0].solo_competitive_rank || 0, plist[0].competitive_rank || 0, Date.now(), plist[0].profile.account_id]
                    }).catch(err => {
                        helper.log("postgres", err, "err");
                    });
                }).catch(err => helper.handle(message, err));

                client.redis.set(`playerinfo:${acc_id}`, JSON.stringify(plist[0]), (err) => {
                    if (err) helper.log(message, err);
                    client.redis.expire(`playerinfo:${acc_id}`, 3600);
                });
            }).catch(err => {
                helper.log(message, `mika failed with err: \n${err}`);
                message.channel.createMessage("Something went wrong.").catch(err => helper.handle(message, err));
            });
        }
    });
}

module.exports = (message, client, helper) => {
    let resolve_user = client.core.util.resolve_user;

    if (message.mentions.length > 0) {
        resolve_user(client, message.mentions[0].id).then(acc_id => {
            send_message(message, client, helper, acc_id);
        }).catch(err => {
            if (err == "nouser") {
                message.channel.createMessage(`That user has not registered with me yet! Try \`${message.gcfg.prefix}help register\`.`).catch(err => helper.handle(message, err));
            } else {
                message.channel.createMessage("Something went wrong selecting this user from the database.").catch(err => helper.handle(message, err));
                helper.log(message, err);
            }
        });
    } else {
        let options = message.content.split(" ");
        options.shift();
        let acc_id = options[0];
        let name = options.join(" ").toLowerCase();
        let inguild = message.channel.guild.members.find(member => (member.nick || member.username).toLowerCase() == name || member.username.toLowerCase() == name);

        if (inguild) {
            resolve_user(client, inguild.id).then(acc_id => {
                send_message(message, client, helper, acc_id);
            }).catch(err => {
                if (err == "nouser") {
                    message.channel.createMessage(`That user has not registered with me yet! Try \`${message.gcfg.prefix}help register\`.`);
                } else {
                    message.channel.createMessage("Something went wrong selecting this user from the database.");
                    helper.log(message, err);
                }
            });
            return;
        }

        if (!acc_id) {
            resolve_user(client, message.author.id).then(acc_id => {
                send_message(message, client, helper, acc_id);
            }).catch(err => {
                if (err == "nouser") {
                    message.channel.createMessage(`You have not registered with me yet! Try \`${message.gcfg.prefix}help register\`.`);
                } else {
                    message.channel.createMessage("Something went wrong selecting this user from the database.");
                    helper.log(message, err);
                }
            });
            return;
        }

        if (acc_id.match("dotabuff") || acc_id.match("opendota")) {
            let url = acc_id.split("/");
            acc_id = url[url.length - 1];
        }

        if (isNaN(acc_id)) {
            message.channel.createMessage("I couldn't find an account ID in your message!").catch(err => helper.handle(message, err));
            return;
        }

        send_message(message, client, helper, acc_id);
    }
};
