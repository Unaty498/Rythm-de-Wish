import Discord, {
	ButtonInteraction,
	Collection,
	GuildChannel,
	GuildMember,
	Message,
	MessageActionRow,
	MessageButton,
	MessageEmbed,
	MessageSelectMenu,
	MessageSelectOptionData,
	SelectMenuInteraction,
	Snowflake,
} from "discord.js";
import {
	AudioPlayerStatus,
	StreamType,
	createAudioPlayer,
	createAudioResource,
	getVoiceConnection,
	getVoiceConnections,
	joinVoiceChannel,
	AudioPlayer,
} from "@discordjs/voice";

import PlayDl, { YouTubeVideo } from "play-dl";

require("dotenv").config();

interface Song {
	id?: string;
	duration?: number;
	title?: string;
	url?: string;
	thumbnail?: string;
	artist?: {
		name?: string;
		icon?: string;
	}
}

function durationToTime(duration: number): string {
	let str: string = "";
	if (Math.floor(duration / 3600) > 0) {
		str +=
			(Math.floor(duration / 3600) < 10
				? "0" + Math.floor(duration / 3600)
				: Math.floor(duration / 3600)) + ":";
		duration %= 3600;
	}

	str +=
		duration < 0
			? "00"
			: (Math.floor(duration / 60) < 10
				? "0" + Math.floor(duration / 60)
				: Math.floor(duration / 60)) + ":";
	duration %= 60;

	str += duration < 0 ? "00" : duration < 10 ? "0" + duration : duration;
	return str;
}

function registerPlayer(guildId: string): void {
	const { player } = client.queue.get(guildId);
	player.on(AudioPlayerStatus.Idle, () => {
		const { player, playing, loop, loopQueue } = client.queue.get(guildId);
		if (loop) {
			client.emit("playUpdate", guildId);
			return;
		} else {
			if (client.queue.get(guildId).queue.length > 0) {
				if (loopQueue) {
					client.queue
						.get(guildId)
						.queue.push(
							playing as { id: string; duration: number }
						);
				}
				const play = client.queue.get(guildId).queue.shift();
				client.queue.set(guildId, {
					player: player,
					playBegin: Math.floor(Date.now() / 1000),
					playing: play,
					queue: client.queue.get(guildId).queue,
				});
				client.emit("playUpdate", guildId);
			} else {
				client.queue.set(guildId, {
					playBegin: undefined,
					playing: {},
					queue: [],
				});
				player.removeAllListeners();
			}
		}
	});
}

class Rythm extends Discord.Client {
	queue: Collection<
		Snowflake,
		{
			loop?: boolean;
			loopQueue?: boolean;
			player?: AudioPlayer;
			playBegin?: number;
			playing: Song;
			queue: Song[];
		}
	>;
	constructor(options: Discord.ClientOptions) {
		super(options);
		this.queue = new Collection();
	}
}

const client = new Rythm({
	intents: [
		Discord.Intents.FLAGS.GUILDS,
		Discord.Intents.FLAGS.GUILD_VOICE_STATES,
		Discord.Intents.FLAGS.GUILD_MEMBERS,
	],
});

client.once("ready", () => {
	console.log(`Logged in as ${client.user.tag} !`);

	client.guilds.cache
		.forEach((guild) => {
			guild.commands.set([
				{
					name: "join",
					description: "Rejoins le salon vocal !",
					options: [
						{
							name: "salon",
							description: "Le salon à rejoindre",
							type: "CHANNEL",
							channelTypes: ["GUILD_VOICE", "GUILD_STAGE_VOICE"],
							required: false,
						},
					],
				},
				{
					name: "play",
					description: "Joue la musique recherchée !",
					options: [
						{
							name: "query",
							description: "Nom / Lien de la musique",
							required: true,
							type: "STRING",
						},
					],
				},
				{
					name: "search",
					description:
						"Propose une liste de musiques à partir d'une recherche",
					options: [
						{
							name: "query",
							description: "Nom de la musique",
							required: true,
							type: "STRING",
						},
						{
							name: "results",
							description: "Le nombre de résultats à afficher",
							type: "INTEGER",
							minValue: 1,
							maxValue: 25,
							required: false,
						},
					],
				},
				{
					name: "clear-queue",
					description: "Supprimme toutes les musiques de la queue",
				},
				{
					name: "clear",
					description: "Supprimme une musique de la queue",
					options: [
						{
							name: "position",
							description: "Position du morceau dans la queue",
							type: "INTEGER",
							required: true,
						},
					],
				},
				{
					name: "skip",
					description: "Skip une musique",
				},
				{
					name: "leave",
					description: "Quitte le salon",
				},
				{
					name: "queue",
					description: "Affiche la queue",
				},
				{
					name: "loop",
					description: "Joue le morceau en boucle",
				},
				{
					name: "loop-queue",
					description: "Joue la queue en boucle",
				},
				{
					name: "insert",
					description:
						"Insère la musique choisie à la place donnée de la queue (au début si non précisé)",
					options: [
						{
							name: "query",
							description: "Nom / Lien de la musique",
							required: true,
							type: "STRING",
						},
						{
							name: "position",
							description: "Emplacement où insérer",
							type: "INTEGER",
							required: false,
						},
					],
				},
				{
					name: "shuffle",
					description: "Mélange la queue",
				},
				{
					name: "pause",
					description: "Met en pause la musique",
				},
				{
					name: "resume",
					description: "Reprend la musique",
				},
				{
					name: "now-playing",
					description: "Affiche la musique en cours",
				},
				{
					name: "seek",
					description: "Joue la musique au moment donné",
					options: [
						{
							name: "position",
							description: "Position de la musique",
							type: "STRING",

							required: true,
						},
					],
				}
			]);
		});
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isCommand()) return;

	if (interaction.commandName === "join") {
		if (!client.queue.get(interaction.guildId))
			client.queue.set(interaction.guildId, {
				playing: {},
				queue: [],
			});
		let channel = interaction.options.getChannel(
			"salon",
			false
		) as GuildChannel;

		if (!channel)
			channel = (interaction.member as GuildMember).voice?.channel;

		if (!channel || !channel?.isVoice()) {
			await interaction.reply({
				content:
					"Vous n'êtes pas dans un salon vocal ou le salon précisé n'est pas un salon vocal !",
				ephemeral: true,
			});
			return;
		} else {
			joinVoiceChannel({
				channelId: channel.id,
				guildId: interaction.guild.id,
				adapterCreator: interaction.guild.voiceAdapterCreator,
			});

			await interaction.reply("✅ - Joined " + channel.name);
			return;
		}
	}
	if (interaction.commandName === "leave") {
		const connection = getVoiceConnection(interaction.guildId);

		if (connection) {
			connection.destroy();
			await interaction.reply("Disconnected.");
		} else {
			await interaction.reply({
				content: "Le bot n'est pas connecté !",
				ephemeral: true,
			});
		}
	}
	if (interaction.commandName === "play") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply(
				"Je dois être dans un salon vocal pour jouer de la musique !"
			);
			return;
		}
		let query = interaction.options.getString("query", true);
		let infos: YouTubeVideo;
		if (PlayDl.yt_validate(query)) {
			infos = (await PlayDl.video_basic_info(query)).video_details;
		} else {
			infos = (await PlayDl.search(query, { language: "fr", limit: 1 }))[0];
		}


		const videoEmbed = new MessageEmbed()
			.setDescription(`**[${infos.title}](${infos.url})**`)
			.setThumbnail(infos.thumbnails[0].url)
			.setAuthor({
				name: "Ajouté à la queue",
				iconURL: interaction.user.avatarURL({ format: "png" })
			})
			.addField("Auteur", infos.music?.[0].artist ?? infos.channel.name, true)
			.addField("Durée", durationToTime(infos.durationInSec), true)
			.setFooter({ text: "Made by Unaty498", iconURL: infos.channel.icons[0].url });

		if (client.queue.get(interaction.guildId).playing.id) {
			videoEmbed
				.addField(
					"Temps avant de le jouer",
					durationToTime(
						client.queue.get(interaction.guildId).playBegin -
						Math.floor(Date.now() / 1000) +
						client.queue.get(interaction.guildId).playing
							.duration +
						(client.queue
							.get(interaction.guildId)
							.queue.reduce((p, c) => p + c.duration, 0) || 0)
					),
					true
				)
				.addField(
					"Position dans la queue :",
					`**${client.queue.get(interaction.guildId).queue.length + 1
					}**`
				)
			client.queue
				.get(interaction.guildId)
				.queue.push({
					id: infos.id,
					duration: infos.durationInSec,
					artist: {
						name: infos.music?.[0].artist ?? infos.channel.name,
						icon: infos.channel.icons[0].url
					},
					title: infos.title,
					url: infos.url,
					thumbnail: infos.thumbnails[0].url
				});
		} else {
			client.queue.set(interaction.guildId, {
				player: createAudioPlayer(),
				playBegin: Math.floor(Date.now() / 1000),
				playing: {
					id: infos.id,
					duration: infos.durationInSec,
					artist: {
						name: infos.music?.[0].artist ?? infos.channel.name,
						icon: infos.channel.icons[0].url
					},
					title: infos.title,
					url: infos.url,
					thumbnail: infos.thumbnails[0].url },
				queue: [],
				loop: false,
				loopQueue: false,
			});

			client.emit("playUpdate", interaction.guildId);
			registerPlayer(interaction.guildId);
		}

		await interaction.reply({ embeds: [videoEmbed] });
	}
	if (interaction.commandName === "insert") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply(
				"Je dois être dans un salon vocal pour jouer de la musique !"
			);
			return;
		}
		let index = interaction.options.getInteger("position", false) - 1;
		const { id, title, duration } = (await resolveId(
			interaction.options.getString("query", true)
		)) as { id: string; title: string; duration: number };
		const {
			videoDetails: {
				author: {
					thumbnails: [{ url: avatar }],
					name,
				},
			},
		} = await ytdl.getBasicInfo(id);

		let videoEmbed: MessageEmbed;
		if (index && index > 0) {
			if (index > client.queue.get(interaction.guildId).queue.length)
				index = client.queue
					.get(interaction.guildId)
					.queue.push({ id: id, duration: duration });
			else
				client.queue.get(interaction.guildId).queue = [
					...client.queue
						.get(interaction.guildId)
						.queue.slice(0, index),
					{ id: id, duration: duration },
					...client.queue.get(interaction.guildId).queue.slice(index),
				];

			videoEmbed = new MessageEmbed()
				.setAuthor(
					"Ajouté à la queue",
					interaction.user.avatarURL({ format: "png" })
				)
				.setDescription(`**[${title}](https://youtu.be/${id})**`)
				.setThumbnail(`https://img.youtube.com/vi/${id}/hqdefault.jpg`)
				.addField("Auteur", name, true)
				.addField("Durée", durationToTime(duration), true)
				.addField(
					"Temps avant de le jouer",
					durationToTime(
						client.queue.get(interaction.guildId).playBegin -
						Math.floor(Date.now() / 1000) +
						client.queue.get(interaction.guildId).playing
							.duration +
						(client.queue
							.get(interaction.guildId)
							.queue.slice(0, index)
							.reduce((p, c) => p + c.duration, 0) || 0)
					),
					true
				)
				.addField("Position dans la queue :", `**${index}**`)
				.setFooter("Made by Unaty498", avatar);
		} else {
			client.queue
				.get(interaction.guildId)
				.queue.unshift({ id: id, duration: duration });

			videoEmbed = new MessageEmbed()
				.setAuthor(
					"Ajouté à la queue",
					interaction.user.avatarURL({ format: "png" })
				)
				.setDescription(`**[${title}](https://youtu.be/${id})**`)
				.setThumbnail(`https://img.youtube.com/vi/${id}/hqdefault.jpg`)
				.addField("Auteur", name, true)
				.addField("Durée", durationToTime(duration), true)
				.addField(
					"Temps avant de le jouer",
					durationToTime(
						client.queue.get(interaction.guildId).playBegin -
						Math.floor(Date.now() / 1000) +
						client.queue.get(interaction.guildId).playing
							.duration
					),
					true
				)
				.addField("Position dans la queue :", `**1**`)
				.setFooter("Made by Unaty498", avatar);
		}
		await interaction.reply({ embeds: [videoEmbed] });
	}
	if (interaction.commandName === "search") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply(
				"Je dois être dans un salon vocal pour jouer de la musique !"
			);
			return;
		}
		const query = interaction.options.getString("query", true);
		const results = interaction.options.getInteger("results", false) ?? 10;
		let resultsNumber = results > 20 ? 20 : results < 5 ? 5 : results;
		let songs = await searchSongs(query, resultsNumber);
		let rows = [
			new MessageActionRow().addComponents([
				new MessageSelectMenu()
					.setCustomId("song")
					.setMinValues(1)
					.setMaxValues(1)
					.setPlaceholder("Sélectionnez la musique voulue...")
					.addOptions(
						songs.map((s) => ({
							value: s.id,
							label: `${s.title} | ${durationToTime(s.duration)}`,
						})) as MessageSelectOptionData[]
					),
			]),
			new MessageActionRow().addComponents(
				new MessageButton()
					.setCustomId("c")
					.setStyle("DANGER")
					.setEmoji("✖️")
			),
		];
		const message = (await interaction.reply({
			content: "Résultat de la recherche :",
			components: rows,
			fetchReply: true,
		})) as Message;
		const collector = message.createMessageComponentCollector<
			SelectMenuInteraction | ButtonInteraction
		>({
			time: 60_000,
		});
		collector.on("collect", async (selected) => {
			if (selected.user.id !== interaction.user.id) {
				await selected.reply({
					content: "Seul l'auteur de la commande peut choisir...",
					ephemeral: true,
				});
				return;
			}
			if (selected.isButton()) {
				await selected.update({ content: "Annulé", components: [] });
				return;
			}
			let { id, duration } = songs.find(
				(e) => e.id === selected.values[0]
			);
			let {
				videoDetails: {
					title,
					author: {
						thumbnails: [{ url: avatar }],
						name,
					},
				},
			} = await ytdl.getBasicInfo(id);
			let videoEmbed: MessageEmbed;

			if (client.queue.get(interaction.guildId).playing.id) {
				videoEmbed = new MessageEmbed()
					.setAuthor(
						"Ajouté à la queue",
						interaction.user.avatarURL({ format: "png" })
					)
					.setDescription(`**[${title}](https://youtu.be/${id})**`)
					.setThumbnail(
						`https://img.youtube.com/vi/${id}/hqdefault.jpg`
					)
					.addField("Auteur", name, true)
					.addField("Durée", durationToTime(duration), true)
					.addField(
						"Temps avant de le jouer",
						durationToTime(
							client.queue.get(interaction.guildId).playBegin -
							Math.floor(Date.now() / 1000) +
							client.queue.get(interaction.guildId).playing
								.duration +
							(client.queue
								.get(interaction.guildId)
								.queue.reduce(
									(p, c) => p + c.duration,
									0
								) || 0)
						),
						true
					)
					.addField(
						"Position dans la queue :",
						`**${client.queue.get(interaction.guildId).queue.length +
						1
						}**`
					)
					.setFooter("Made by Unaty498", avatar);
				client.queue
					.get(interaction.guildId)
					.queue.push({ id: id, duration: duration });
				await selected.update({
					content: null,
					components: [],
					embeds: [videoEmbed],
				});
			} else {
				videoEmbed = new MessageEmbed()
					.setAuthor(
						"Ajouté à la queue",
						interaction.user.avatarURL({ format: "png" })
					)
					.setDescription(`**[${title}](https://youtu.be/${id})**`)
					.setThumbnail(
						`https://img.youtube.com/vi/${id}/hqdefault.jpg`
					)
					.addField("Auteur", name, true)
					.addField("Durée", durationToTime(duration), true)
					.setFooter("Made by Unaty498", avatar);
				client.queue.set(interaction.guildId, {
					player: createAudioPlayer(),
					playBegin: Math.floor(Date.now() / 1000),
					playing: { id: id, duration: duration },
					queue: [],
					loop: false,
					loopQueue: false,
				});
				await selected.update({
					content: null,
					components: [],
					embeds: [videoEmbed],
				});

				client.emit("playUpdate", interaction.guildId);
				registerPlayer(interaction.guildId);
			}
			collector.stop();
		});
	} else if (interaction.commandName === "skip") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(interaction.guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		let playing = client.queue.get(interaction.guildId).queue.shift() ?? {};
		client.queue.get(interaction.guildId).playing = playing;
		client.emit("playUpdate", interaction.guildId);
		await interaction.reply("Skipped");
	} else if (interaction.commandName === "queue") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(interaction.guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}

		const ids = [
			client.queue.get(interaction.guildId).playing.id,
			...client.queue.get(interaction.guildId).queue.map((s) => s.id),
		];
		const durations = [
			client.queue.get(interaction.guildId).playing.duration,
			...client.queue
				.get(interaction.guildId)
				.queue.map((s) => s.duration),
		];
		const res = await axios.get(
			"https://www.googleapis.com/youtube/v3/videos?" +
			new URLSearchParams({
				part: "snippet",
				id: ids.join(","),
				key: process.env.ytToken,
			})
		);
		const queue = res.data.items.map((item, i) => [
			ids[i],
			item.snippet.title,
			durations[i],
		]) as [string, string, number][];
		let page = 0;
		let pages = queue.map(([id, title, duration], i) =>
			i === 0
				? `__Now playing__ :\n [${title}](https://youtu.be/${id}}]) | \`${durationToTime(
					client.queue.get(interaction.guildId).playBegin -
					Math.floor(Date.now() / 1000) +
					client.queue.get(interaction.guildId).playing
						.duration
				)}\`${queue.length > 1 ? "\n\n__Up Next__ :" : ""}`
				: `\`${i}\` | [${title}](https://youtu.be/${id}}]) | \`${durationToTime(
					duration
				)}\`\n`
		);
		const getContent = (p: number) =>
			pages.slice(p * 10, p * 10 + 10).join("\n");
		const calcTotalPages = () => Math.ceil(pages.length / 10);
		const queueEmbed = new MessageEmbed()
			.setTitle("Queue :")
			.setDescription(
				getContent(page) +
				`\n\n**${queue.length
				} musique(s) dans la queue | Temps total : ${durationToTime(
					client.queue.get(interaction.guildId).playBegin -
					Math.floor(Date.now() / 1000) +
					client.queue.get(interaction.guildId).playing
						.duration +
					(client.queue
						.get(interaction.guildId)
						.queue.reduce((p, c) => p + c.duration, 0) || 0)
				)}**`
			)
			.setFooter(
				`Page ${page + 1}/${calcTotalPages()} | Loop: ${client.queue.get(interaction.guildId).loop ? "✅" : "❌"
				} | Queue Loop: ${client.queue.get(interaction.guildId).loopQueue
					? "✅"
					: "❌"
				}`,
				interaction.user.avatarURL({ format: "png" })
			);
		if (calcTotalPages() > 1) {
			const row = new MessageActionRow().addComponents([
				new MessageButton()
					.setCustomId("-")
					.setStyle("PRIMARY")
					.setEmoji("◀️")
					.setDisabled(true),
				new MessageButton()
					.setCustomId("+")
					.setStyle("PRIMARY")
					.setEmoji("▶️"),
			]);
			const message = (await interaction.reply({
				embeds: [queueEmbed],
				components: [row],
				fetchReply: true,
			})) as Message;
			const collector =
				message.createMessageComponentCollector<ButtonInteraction>({
					time: 300_000,
					componentType: "BUTTON",
				});
			collector.on("collect", async (button) => {
				if (button.user.id !== interaction.user.id) {
					await button.reply({
						content:
							"Seul l'auteur de la commande peut intéragir...",
						ephemeral: true,
					});
					return;
				}
				if (button.customId === "+") {
					page += 1;
					if (page === calcTotalPages() - 1)
						row.components[1].disabled = true;
					row.components[0].disabled = false;
				}
				if (button.customId === "-") {
					page -= 1;
					if (page === 0) row.components[0].disabled = true;
					row.components[1].disabled = false;
				}
				await button.update({
					embeds: [
						queueEmbed
							.setDescription(
								getContent(page) +
								`\n**${queue.length
								} musique(s) dans la queue | Temps total : ${durationToTime(
									client.queue.get(interaction.guildId)
										.playBegin -
									Math.floor(Date.now() / 1000) +
									client.queue.get(
										interaction.guildId
									).playing.duration +
									(client.queue
										.get(interaction.guildId)
										.queue.reduce(
											(p, c) => p + c.duration,
											0
										) || 0)
								)}**`
							)
							.setFooter(
								`Page ${page + 1}/${calcTotalPages()} | Loop: ${client.queue.get(interaction.guildId).loop
									? "✅"
									: "❌"
								} | Queue Loop: ${client.queue.get(interaction.guildId)
									.loopQueue
									? "✅"
									: "❌"
								}`,
								interaction.user.avatarURL({ format: "png" })
							),
					],
					components: [row],
				});
			});
		} else {
			await interaction.reply({ embeds: [queueEmbed] });
		}
	}
	if (interaction.commandName === "loop") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(interaction.guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		client.queue.get(interaction.guildId).loop = !client.queue.get(
			interaction.guildId
		).loop;
		await interaction.reply(
			`:repeat: Loop ${!client.queue.get(interaction.guildId).loop ? "dés" : ""
			}activée !`
		);
	}
	if (interaction.commandName === "loop-queue") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(interaction.guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		client.queue.get(interaction.guildId).loopQueue = !client.queue.get(
			interaction.guildId
		).loopQueue;
		await interaction.reply(
			`:repeat: Loop ${!client.queue.get(interaction.guildId).loopQueue ? "dés" : ""
			}activée !`
		);
	}
	if (interaction.commandName === "clear-queue") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(interaction.guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		if (client.queue.get(interaction.guildId).queue.length === 0) {
			await interaction.reply("La queue est déjà vide !");
			return;
		}
		client.queue.get(interaction.guildId).queue = [];
		await interaction.reply("💥 Queue vidée !");
	}
	if (interaction.commandName === "clear") {
		if (!getVoiceConnection(interaction.guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(interaction.guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		if (client.queue.get(interaction.guildId).queue.length === 0) {
			await interaction.reply("La queue est vide !");
			return;
		}
		const index = interaction.options.getInteger("position", true) - 1;
		let song = client.queue.get(interaction.guildId).queue[index];
		if (song) {
			const {
				data: {
					items: [
						{
							snippet: { title },
						},
					],
				},
			} = await axios.get(
				"https://www.googleapis.com/youtube/v3/videos?" +
				new URLSearchParams({
					part: "snippet",
					id: song.id,
					key: process.env.ytToken,
				})
			);
			client.queue.get(interaction.guildId).queue.splice(index, 1);
			await interaction.reply(`Enlevé le morceau : \`${title}\``);
		} else {
			await interaction.reply("Aucune musique n'est à cette position !");
		}
	}
});

client.on("playUpdate", (guildId: string): void => {
	const {
		player,
		playing: { id },
	} = client.queue.get(guildId);
	if (id) {
		client.queue.get(guildId).playBegin = Math.floor(Date.now() / 1000);
		const resource = createAudioResource(
			ytdl(id, {
				filter: "audioonly",
				quality: "highestaudio",
				highWaterMark: 1 << 25,
			}),
			{
				inputType: StreamType.Arbitrary,
			}
		);
		player.play(resource);
		getVoiceConnection(guildId).subscribe(player);
	} else {
		player.removeAllListeners();
		player.stop();
	}
});

client.login(process.env.token);

process.on("SIGINT", () => {
	getVoiceConnections().forEach((c) => c.destroy());
	process.exit(0);
});
process.on("SIGTERM", () => {
	getVoiceConnections().forEach((c) => c.destroy());
	process.exit(0);
});
process.on("SIGKILL", () => {
	getVoiceConnections().forEach((c) => c.destroy());
	process.exit(0);
});
