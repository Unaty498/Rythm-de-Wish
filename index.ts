import {
	Client,
	ClientOptions,
	Collection,
	GuildChannel,
	GuildMember,
	GatewayIntentBits,
	Message,
	ActionRowBuilder,
	ButtonBuilder,
	Snowflake,
	User,
	EmbedBuilder,
	ApplicationCommandOptionType,
	ChannelType,
	ButtonStyle,
	ComponentType,
	StringSelectMenuBuilder,
	AttachmentBuilder,
	TextChannel,
	GuildPremiumTier,
} from "discord.js";
import { inspect } from "util";
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, getVoiceConnection, getVoiceConnections, joinVoiceChannel, AudioPlayer, VoiceConnectionStatus, VoiceConnection } from "@discordjs/voice";
import ytdl from "@distube/ytdl-core";
import PlayDl, { YouTubeVideo } from "play-dl";
import dotenv from "dotenv";
dotenv.config();

interface Song {
	id?: string;
	duration?: number;
	title?: string;
	url?: string;
	thumbnail?: string;
	artist?: {
		name?: string;
		icon?: string;
	};
	chapters?: {
		title?: string;
		seconds?: number;
	}[];
}

interface Playlist {
	title?: string;
	songs?: Song[];
	url?: string;
	thumbnail?: string;
	duration?: number;
	artist?: {
		name?: string;
		icon?: string;
	};
}

function getPlaylist(url: string): Promise<Playlist> {
	return new Promise(async (resolve, reject) => {
		try {
			url = formatURL(url);
			const res = await PlayDl.playlist_info(url, { incomplete: true });
			const songs = (await res.all_videos()).map(formatSong);
			resolve({
				title: res.title,
				songs: songs,
				url: res.url,
				thumbnail: res.thumbnail.url,
				duration: songs.reduce((acc, song) => acc + song.duration, 0),
				artist: {
					name: res.channel.name,
					icon: res.channel.icons[0].url,
				},
			});
		} catch (err) {
			reject("Couldn't find/get the playlist.");
		}
	});
}

function formatURL(url: string) {
	if (url.includes("list")) {
		return `https://www.youtube.com/playlist?list=${/list=([a-zA-Z0-9_\-]*?)(?:&|$)/.exec(url)[1]}`;
	} else if (url.includes("youtu.be/")) {
		return `https://www.youtube.com/watch?v=${/youtu.be\/([a-zA-Z0-9_\-]*?)(?:\?|&|$)/.exec(url)[1]}`;
	} else {
		return `https://www.youtube.com/watch?v=${/v=([a-zA-Z0-9_\-]*?)(?:&|$)/.exec(url)[1]}`;
	}
}

function formatSong(song: YouTubeVideo): Song {
	let songTitle = song.music?.[0]?.song;
	let artist = song.music?.[0]?.artist;

	return {
		id: song.id,
		duration: song.durationInSec,
		title: songTitle ?? song.title,
		url: song.url,
		thumbnail: song.thumbnails[0].url,
		artist: {
			name: artist ?? song.channel.name,
			icon: song.channel.icons[0].url,
		},
		chapters: song.chapters.map(({ title, seconds }) => ({ title, seconds })),
	};
}

function getSong(query: string): Promise<Song> {
	return new Promise(async (resolve, reject) => {
		try {
			if (query.startsWith("https://")) query = formatURL(query);
			if (/https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_\-]*/.test(query)) {
				PlayDl.video_basic_info(query).then(({ video_details: res }) => {
					resolve(formatSong(res));
					return;
				});
			}
			const results = await PlayDl.search(query, {
				source: {
					youtube: "video",
				},
				limit: 1,
			});
			if (results.length > 0) {
				resolve(formatSong(results[0]));
			} else {
				reject("Couldn't find/get the video.");
			}
		} catch (err) {
			reject("Couldn't find/get the video.");
		}
	});
}

function searchSongs(query: string, limit: number): Promise<Song[]> {
	return new Promise(async (resolve, reject) => {
		try {
			const results = await PlayDl.search(query, {
				source: {
					youtube: "video",
				},
				limit,
			});
			resolve(results.map(formatSong));
		} catch (err: unknown) {
			reject("Couldn't search for the video.");
		}
	});
}

function generateEmbed(song: Song, user: User): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({
			name: "Ajouté à la queue",
			iconURL: user.avatarURL({ extension: "png" }),
		})
		.setDescription(`**[${song.title}](${song.url})**`)
		.setThumbnail(song.thumbnail)
		.addFields([
			{ name: "Auteur", value: song.artist.name, inline: true },
			{ name: "Durée", value: durationToTime(song.duration), inline: true },
		])
		.setFooter({
			text: "Made with ❤️ by @unaty",
			iconURL: "https://cdn.discordapp.com/avatars/272013870191738881/049f3e0331f80997e421a1c7cd58fe5b.webp",
		});
}

function generatePlaylistEmbed(playlist: Playlist, user: User): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({
			name: "Ajouté à la queue",
			iconURL: user.avatarURL({ extension: "png" }),
		})
		.setDescription(`**[${playlist.title}](${playlist.url})**`)
		.setThumbnail(playlist.thumbnail)
		.addFields([
			{ name: "Auteur", value: playlist.artist.name, inline: true },
			{ name: "Durée", value: durationToTime(playlist.duration), inline: true },
			{ name: "Songs", value: playlist.songs.length.toString(), inline: true },
		])
		.setFooter({
			text: "Made with ❤️ by @unaty",
			iconURL: "https://cdn.discordapp.com/avatars/272013870191738881/049f3e0331f80997e421a1c7cd58fe5b.webp",
		});
}

function generateErrorEmbed(error: string): EmbedBuilder {
	const formatted = error.toString().slice(0, 4096).trim();
	return new EmbedBuilder().setColor(0xff0000).setTitle("The bot encountered an error").setDescription(formatted);
}

function addLeadingZero(num: number): string {
	return num < 10 ? "0" + num : num.toString();
}

function getTime(guildId: Snowflake, index?: number) {
	const next = index ? (client.queue.get(guildId)?.queue?.slice(0, index)?.reduce((p, c) => p + c.duration, 0) || 0) : (client.queue.get(guildId)?.queue?.reduce((p, c) => p + c.duration, 0) || 0);
	if (client.queue.get(guildId).paused) {
		return client.queue.get(guildId).playing.duration - client.queue.get(guildId).musicTimePaused + next;
	}
	return client.queue.get(guildId).playBegin - Math.floor(Date.now() / 1000) + client.queue.get(guildId).playing.duration + next;
}

function durationToTime(duration: number): string {
	let str: string = "";
	if (Math.floor(duration / 3600) > 0) {
		str += addLeadingZero(Math.floor(duration / 3600)) + ":";
		duration %= 3600;
	}

	str += duration < 0 ? "00" : addLeadingZero(Math.floor(duration / 60)) + ":";
	duration %= 60;

	str += duration < 0 ? "00" : addLeadingZero(duration);
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
					client.queue.get(guildId).queue.push(playing as { id: string; duration: number });
				}
				const play = client.queue.get(guildId).queue.shift();
				client.queue.set(guildId, {
					player: player,
					playBegin: Math.floor(Date.now() / 1000),
					playing: play,
					queue: client.queue.get(guildId).queue,
					channel: client.queue.get(guildId).channel,
					paused: false,
					musicTimePaused: 0
				});
				client.emit("playUpdate", guildId);
			} else {
				client.queue.set(guildId, {
					playBegin: undefined,
					playing: {},
					queue: [],
					channel: client.queue.get(guildId).channel,
					paused: false,
					musicTimePaused: 0
				});
				player?.removeAllListeners();
			}
		}
	});
}

const networkStateChangeHandler = (oldNetworkState: any, newNetworkState: any) => {
	const newUdp = Reflect.get(newNetworkState, "udp");
	clearInterval(newUdp?.keepAliveInterval);
};

function registerConnection(guildId: string, connection: VoiceConnection): void {
	connection.on("stateChange", (oldState, newState) => {
		Reflect.get(oldState, "networking")?.off("stateChange", networkStateChangeHandler);
		Reflect.get(newState, "networking")?.on("stateChange", networkStateChangeHandler);
	});
}

class Rythm extends Client {
	queue: Collection<
		Snowflake,
		{
			channel: Snowflake;
			loop?: boolean;
			loopQueue?: boolean;
			player?: AudioPlayer;
			playBegin?: number;
			playing: Song;
			paused: boolean;
			musicTimePaused: number;
			queue: Song[];
		}
	>;

	constructor(options: ClientOptions) {
		super(options);
		this.queue = new Collection();
	}
}

const client = new Rythm({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

client.once("ready", async () => {
	console.log(`Logged in as ${client.user.tag} !`);

	await client.application.commands.set([
		{
			name: "join",
			description: "Rejoins le salon vocal !",
			options: [
				{
					name: "salon",
					description: "Le salon à rejoindre",
					type: ApplicationCommandOptionType.Channel,
					channelTypes: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
					required: false,
				},
			],
		},
		{
			name: "eval",
			description: "Evaluate code (Super-User Only)",
			options: [
				{
					name: "code",
					description: "Code à exécuter",
					type: ApplicationCommandOptionType.String,
					required: true,
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
					type: ApplicationCommandOptionType.String,
				},
			],
		},
		{
			name: "search",
			description: "Propose une liste de musiques à partir d'une recherche",
			options: [
				{
					name: "query",
					description: "Nom de la musique",
					required: true,
					type: ApplicationCommandOptionType.String,
				},
				{
					name: "results",
					description: "Le nombre de résultats à afficher",
					type: ApplicationCommandOptionType.Integer,
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
					type: ApplicationCommandOptionType.Integer,
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
			description: "Insère la musique choisie à la place donnée de la queue (au début si non précisé)",
			options: [
				{
					name: "query",
					description: "Nom / Lien de la musique",
					required: true,
					type: ApplicationCommandOptionType.String,
				},
				{
					name: "position",
					description: "Emplacement où insérer",
					type: ApplicationCommandOptionType.Integer,
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
					description: "Position de la musique en secondes",
					type: ApplicationCommandOptionType.Integer,
					minValue: 0,
					required: true,
				},
			],
		},
		{
			name: "download",
			description: "Télécharge la musique",
			options: [
				{
					name: "query",
					description: "Nom / Lien de la musique",
					required: true,
					type: ApplicationCommandOptionType.String,
				},
				{
					name: "mp4",
					description: "Télécharger au format mp4 (si possible)",
					required: false,
					type: ApplicationCommandOptionType.Boolean,
				},
			],
		},
	]);
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	const { guildId, commandName } = interaction;

	if (commandName === "join") {
		if (!client.queue.get(guildId))
			client.queue.set(guildId, {
				playing: {},
				queue: [],
				channel: interaction.channelId,
				paused: false,
				musicTimePaused: 0
			});
		let channel = (interaction.options.getChannel("salon", false) as GuildChannel) ?? (interaction.member as GuildMember).voice?.channel ?? (interaction.channel.isVoiceBased() ? interaction.channel : null);

		if (!channel || !channel.isVoiceBased()) {
			await interaction.reply({
				content: "Vous n'êtes pas dans un salon vocal ou le salon précisé n'est pas un salon vocal !",
				ephemeral: true,
			});
			return;
		} else if (!channel.joinable) {
			await interaction.reply({
				content: "Je ne peux pas rejoindre ce salon !",
				ephemeral: true,
			});
			return;
		} else {
			registerConnection(
				guildId,
				joinVoiceChannel({
					channelId: channel.id,
					guildId: guildId,
					adapterCreator: interaction.guild.voiceAdapterCreator,
				})
			);

			await interaction.reply("✅ - Joined " + channel.name);
			return;
		}
	}
	if (commandName === "eval") {
		const code = interaction.options.getString("code");
		if (interaction.user.id !== "272013870191738881") {
			await interaction.reply({ content: "no.", ephemeral: true });
			return;
		}
		await interaction.deferReply();
		try {
			let evaled = await eval(code);
			let content = inspect(evaled);
			interaction.editReply({ embeds: [new EmbedBuilder().setDescription("```js\n" + (content.length > 4087 ? `${content.substring(0, 4084)}...` : content) + "```")] }).catch((e) => console.log(e));
		} catch (e) {
			interaction
				.editReply({
					embeds: [new EmbedBuilder().setDescription("```fix\n" + e + "```")],
				})
				.catch((e) => console.log(e));
			return;
		}
	}
	if (commandName === "leave") {
		const connection = getVoiceConnection(guildId);

		if (connection) {
			client.queue.delete(guildId);
			connection.destroy();
			await interaction.reply("Disconnected.");
		} else {
			await interaction.reply({
				content: "Le bot n'est pas connecté !",
				ephemeral: true,
			});
		}
	}
	if (commandName === "download") {
		await interaction.deferReply();
		const query = interaction.options.getString("query", true);

		const maxUploadSize = (interaction.guild.premiumTier === GuildPremiumTier.Tier2 ? 49 : interaction.guild.premiumTier === GuildPremiumTier.Tier3 ? 99 : 24) * 1024 * 1024;

		try {
			const song = await getSong(query);
			if (!song) {
				await interaction.editReply({
					content: "Aucune musique trouvée !",
				});
				return;
			}

			const allowMp4 = interaction.options.getBoolean("mp4") ?? false;

			const info = ytdl.chooseFormat((await ytdl.getInfo(song.url)).formats, {
				filter: (f) => parseInt(f.contentLength) <= maxUploadSize && f.hasAudio && (!f.hasVideo || allowMp4),
			});

			const stream = ytdl(song.url, {
				highWaterMark: 16384,
				filter: (f) => parseInt(f.contentLength) <= maxUploadSize && f.hasAudio && (!f.hasVideo || allowMp4),
			});

			await interaction.editReply({
				content: `🎶 **${song.title}** a été téléchargé !${!info.hasVideo && allowMp4 ? "\nJe n'ai trouvé que l'audio de taille compatible 😣😣😣" : ""}`,
				files: [new AttachmentBuilder(stream).setName(song.title + (info.hasVideo ? ".mp4" : ".mp3"))],
			});
		} catch (err) {
			await interaction.editReply({
				embeds: [generateErrorEmbed(err)],
			});
		}
	}

	if (commandName === "play") {
		if (!client.queue.has(guildId)) {
			client.queue.set(guildId, {
				playing: {},
				queue: [],
				channel: interaction.channelId,
				paused: false,
				musicTimePaused: 0
			});
		}
		if (!getVoiceConnection(guildId)) {
			await (interaction.member as GuildMember).fetch();
			const channel = (interaction.member as GuildMember).voice?.channel ?? (interaction.channel.isVoiceBased() && interaction.channel.joinable ? interaction.channel : null);
			if (channel) {
				registerConnection(
					guildId,
					joinVoiceChannel({
						channelId: channel.id,
						guildId: interaction.guild.id,
						adapterCreator: interaction.guild.voiceAdapterCreator,
					})
				);
			} else {
				await interaction.reply({
					content: "Vous n'êtes pas dans un salon vocal !",
					ephemeral: true,
				});
				return;
			}
		}
		let query = interaction.options.getString("query", true);

		await interaction.deferReply();
		if (query.match(/^https?:\/\//g) && PlayDl.yt_validate(query) === "playlist") {
			try {
				const playlist = await getPlaylist(query);

				const embed = generatePlaylistEmbed(playlist, interaction.user);

				if (client.queue.get(guildId).playing.id) {
					embed.addFields([
						{
							name: "Temps avant de le jouer",
							value: durationToTime(getTime(guildId)),
							inline: true,
						},
						{
							name: "Position dans la queue :",
							value: `**${client.queue.get(guildId).queue.length + 1}-${client.queue.get(guildId).queue.length + playlist.songs.length + 1}**`,
						},
					]);
					client.queue.get(guildId).queue = client.queue.get(guildId).queue.concat(playlist.songs);
				} else {
					const song = playlist.songs.shift();
					client.queue.set(guildId, {
						player: createAudioPlayer(),
						playBegin: Math.floor(Date.now() / 1000),
						playing: song,
						queue: playlist.songs,
						loop: false,
						loopQueue: false,
						channel: interaction.channelId,
						paused: false,
						musicTimePaused: 0
					});

					client.emit("playUpdate", guildId);
					registerPlayer(guildId);
				}
				await interaction.editReply({ embeds: [embed] });
			} catch (e: unknown) {
				await interaction.editReply({ embeds: [generateErrorEmbed(e.toString())] });
			}
		} else {
			try {
				const song: Song = await getSong(query);

				const videoEmbed = generateEmbed(song, interaction.user);

				if (client.queue.get(guildId).playing.id) {
					videoEmbed.addFields([
						{
							name: "Temps avant de le jouer",
							value: durationToTime(getTime(guildId)),
							inline: true,
						},
						{
							name: "Position dans la queue :",
							value: `**${client.queue.get(guildId).queue.length + 1}**`,
						},
					]);
					client.queue.get(guildId).queue.push(song);
				} else {
					client.queue.set(guildId, {
						player: createAudioPlayer(),
						playBegin: Math.floor(Date.now() / 1000),
						playing: song,
						queue: [],
						loop: false,
						loopQueue: false,
						channel: interaction.channelId,
						paused: false,
						musicTimePaused: 0
					});

					client.emit("playUpdate", guildId);
					registerPlayer(guildId);
				}

				await interaction.editReply({ embeds: [videoEmbed] });
			} catch (e: unknown) {
				await interaction.editReply({ embeds: [generateErrorEmbed(e.toString())] });
			}
		}
	}
	if (commandName === "insert") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal pour jouer de la musique !");
			return;
		}
		await interaction.deferReply();
		let index = interaction.options.getInteger("position", false) - 1;

		try {
			const song = await getSong(interaction.options.getString("query", true));

			let videoEmbed: EmbedBuilder;
			if (index && index > 0) {
				if (index > client.queue.get(guildId).queue.length) index = client.queue.get(guildId).queue.push(song);
				else client.queue.get(guildId).queue = [...client.queue.get(guildId).queue.slice(0, index), song, ...client.queue.get(guildId).queue.slice(index)];

				videoEmbed = generateEmbed(song, interaction.user).addFields([
					{
						name: "Temps avant de le jouer",
						value: durationToTime(getTime(guildId, index)),
						inline: true,
					},
					{
						name: "Position dans la queue :",
						value: `**${index+1}**`,
					},
				]);
			} else {
				client.queue.get(guildId).queue.unshift(song);

				videoEmbed = generateEmbed(song, interaction.user).addFields([
					{
						name: "Temps avant de le jouer",
						value: durationToTime(getTime(guildId, index)),
						inline: true,
					},
					{
						name: "Position dans la queue :",
						value: `**1**`,
					},
				]);
			}
			await interaction.editReply({ embeds: [videoEmbed] });
		} catch (e: unknown) {
			await interaction.editReply({ embeds: [generateErrorEmbed(e.toString())] });
		}
	}
	if (commandName === "search") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal pour jouer de la musique !");
			return;
		}
		await interaction.deferReply();
		const query = interaction.options.getString("query", true);
		const results = interaction.options.getInteger("results", false) ?? 10;
		let resultsNumber = results > 20 ? 20 : results < 5 ? 5 : results;
		try {
			let songs = await searchSongs(query, resultsNumber);
			let rows = [
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents([
					new StringSelectMenuBuilder()
						.setCustomId("song")
						.setMinValues(1)
						.setMaxValues(1)
						.setPlaceholder("Sélectionnez la musique voulue...")
						.addOptions(
							songs.map((s) => ({
								value: s.id,
								label: `${s.title.slice(0, 100 - durationToTime(s.duration).length - 3)} | ${durationToTime(s.duration)}`,
							}))
						),
				]),
				new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("c").setStyle(ButtonStyle.Danger).setEmoji("✖️")),
			];
			const message = (await interaction.editReply({
				content: "Résultat de la recherche :",
				components: rows,
			})) as Message;

			const collector = message.createMessageComponentCollector<ComponentType.StringSelect | ComponentType.Button>({
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
					collector.stop();
					return;
				} else if (selected.isStringSelectMenu()) {
					const song = songs.find((e) => e.id === selected.values[0]);
					const videoEmbed = generateEmbed(song, interaction.user);

					if (client.queue.get(guildId).playing.id) {
						videoEmbed.addFields([
							{
								name: "Temps avant de le jouer",
								value: durationToTime(getTime(guildId)),
								inline: true,
							},
							{
								name: "Position dans la queue :",
								value: `**${client.queue.get(guildId).queue.length + 1}**`,
							},
						]);
						client.queue.get(guildId).queue.push(song);
						await selected.update({
							content: null,
							components: [],
							embeds: [videoEmbed],
						});
					} else {
						client.queue.set(guildId, {
							player: createAudioPlayer(),
							playBegin: Math.floor(Date.now() / 1000),
							playing: song,
							queue: [],
							loop: false,
							loopQueue: false,
							channel: interaction.channelId,
							paused: false,
							musicTimePaused: 0
						});
						await selected.update({
							content: null,
							components: [],
							embeds: [videoEmbed],
						});

						client.emit("playUpdate", guildId);
						registerPlayer(guildId);
					}
				}
				collector.stop("ok");
			});

			collector.on("end", (_, r) => {
				if (r !== "ok") {
					interaction.editReply("Annulé (timeout)...");
					return;
				}
			});
		} catch (e: unknown) {
			await interaction.editReply({ embeds: [generateErrorEmbed(e.toString())] });
		}
	} else if (commandName === "skip") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		let playing = client.queue.get(guildId).queue.shift() ?? {};
		client.queue.get(guildId).playing = playing;
		client.emit("playUpdate", guildId);
		await interaction.reply("Skipped");
	} else if (commandName === "queue") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		let page = 0;
		let pages = [client.queue.get(guildId).playing]
			.concat(client.queue.get(guildId).queue)
			.map((e, i, a) =>
				i === 0
					? `__Now playing__ :\n [${e.title}](${e.url}) | \`${durationToTime(client.queue.get(guildId).playBegin - Math.floor(Date.now() / 1000) + client.queue.get(guildId).playing.duration)}\`${a.length > 1 ? "\n\n__Up Next__ :" : ""}`
					: `\`${i}\` | [${e.title}](${e.url}) | \`${durationToTime(e.duration)}\`\n`
			);
		const getContent = (p: number) => pages.slice(p * 10, p * 10 + 10).join("\n");
		const calcTotalPages = () => Math.ceil(pages.length / 10);
		const queueEmbed = new EmbedBuilder()
			.setTitle("Queue :")
			.setDescription(
				getContent(page) +
					`\n\n**${client.queue.get(guildId).queue.length} musique(s) dans la queue | Temps total : ${durationToTime(
						getTime(guildId)
					)}**`
			)
			.setFooter({
				text: `Page ${page + 1}/${calcTotalPages()} | Loop: ${client.queue.get(guildId).loop ? "✅" : "❌"} | Queue Loop: ${client.queue.get(guildId).loopQueue ? "✅" : "❌"} | made with ❤️ by @unaty`,
				iconURL: interaction.user.avatarURL({ extension: "png" }),
			});
		if (calcTotalPages() > 1) {
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents([
				new ButtonBuilder().setCustomId("-").setStyle(ButtonStyle.Primary).setEmoji("◀️").setDisabled(true),
				new ButtonBuilder().setCustomId("+").setStyle(ButtonStyle.Primary).setEmoji("▶️"),
			]);
			const message = (await interaction.reply({
				embeds: [queueEmbed],
				components: [row],
				fetchReply: true,
			})) as Message;
			const collector = message.createMessageComponentCollector({
				time: 300_000,
				componentType: ComponentType.Button,
			});
			collector.on("collect", async (button) => {
				if (button.user.id !== interaction.user.id) {
					await button.reply({
						content: "Seul l'auteur de la commande peut intéragir...",
						ephemeral: true,
					});
					return;
				}
				if (button.customId === "+") {
					page += 1;
					if (page === calcTotalPages() - 1) row.components[1].setDisabled(true);
					row.components[0].setDisabled(false);
				}
				if (button.customId === "-") {
					page -= 1;
					if (page === 0) row.components[0].setDisabled(true);
					row.components[1].setDisabled(false);
				}
				await button.update({
					embeds: [
						queueEmbed
							.setDescription(
								getContent(page) +
									`\n**${client.queue.get(guildId).queue.length} musique(s) dans la queue | Temps total : ${durationToTime(
										getTime(guildId)
									)}**`
							)
							.setFooter({
								text: `Page ${page + 1}/${calcTotalPages()} | Loop: ${client.queue.get(guildId).loop ? "✅" : "❌"} | Queue Loop: ${client.queue.get(guildId).loopQueue ? "✅" : "❌"} | made with ❤️ by @unaty`,
								iconURL: interaction.user.avatarURL({ extension: "png" }),
							}),
					],
					components: [row],
				});
			});
		} else {
			await interaction.reply({ embeds: [queueEmbed] });
		}
	}
	if (commandName === "loop") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		client.queue.get(guildId).loop = !client.queue.get(guildId).loop;
		await interaction.reply(`🔁 Loop ${!client.queue.get(guildId).loop ? "dés" : ""}activée !`);
	}
	if (commandName === "loop-queue") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		client.queue.get(guildId).loopQueue = !client.queue.get(guildId).loopQueue;
		await interaction.reply(`🔁 Loop ${!client.queue.get(guildId).loopQueue ? "dés" : ""}activée !`);
	}
	if (commandName === "clear-queue") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		if (client.queue.get(guildId).queue.length === 0) {
			await interaction.reply("La queue est déjà vide !");
			return;
		}
		client.queue.get(guildId).queue = [];
		await interaction.reply("💥 Queue vidée !");
	}
	if (commandName === "clear") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		if (client.queue.get(guildId).queue.length === 0) {
			await interaction.reply("La queue est vide !");
			return;
		}
		const index = interaction.options.getInteger("position", true) - 1;
		let song = client.queue.get(guildId).queue[index];
		if (song) {
			client.queue.get(guildId).queue.splice(index, 1);
			await interaction.reply(`Enlevé le morceau : \`${song.title}\``);
		} else {
			await interaction.reply("Aucune musique n'est à cette position !");
		}
	} else if (commandName === "shuffle") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		if (client.queue.get(guildId).queue.length === 0) {
			await interaction.reply("La queue est vide !");
			return;
		}
		client.queue.get(guildId).queue = client.queue.get(guildId).queue.sort(() => Math.random() - 0.5);
		await interaction.reply("🔀 Queue mélangée !");
	} else if (commandName === "pause") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		if (client.queue.get(guildId).player.pause()) {
			client.queue.get(guildId).paused = true;
			client.queue.get(guildId).musicTimePaused = Math.floor(Date.now() / 1000) - client.queue.get(guildId).playBegin;
			await interaction.reply("⏸ Musique en pause !");
		} else {
			await interaction.reply("⏯ Musique déjà en pause !");
		}
	} else if (commandName === "resume") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		if (client.queue.get(guildId).player.unpause()) {
			client.queue.get(guildId).paused = false;
			client.queue.get(guildId).playBegin = Math.floor(Date.now() / 1000) - client.queue.get(guildId).musicTimePaused
			await interaction.reply("▶ Musique reprise !");
		} else {
			await interaction.reply("▶ Musique déjà en cours !");
		}
	} else if (commandName === "now-playing") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		const song = client.queue.get(guildId).playing;
		const seconds = Math.floor(Date.now() / 1000) - client.queue.get(guildId).playBegin;
		const chapter = song.chapters.find((chapter, index, array) => chapter.seconds <= seconds && (index === array.length - 1 || array[index + 1].seconds > seconds));
		const state = Math.floor(((Math.floor(Date.now() / 1000) - client.queue.get(guildId).playBegin) / song.duration) * 30);
		const string = `${"▬".repeat(state)}🔘${"▬".repeat(29 - state)}`;
		const embed = new EmbedBuilder()
			.setAuthor({
				name: "Now Playing ♪",
				iconURL: client.user.avatarURL(),
			})
			.setColor(0x2f3136)
			.setDescription(`[${song.title}](${song.url})\n\n\`${string}\`\n\n${chapter ? `Chapitre : \`${chapter.title}\`\n` : ""}\`${durationToTime(seconds)}/${durationToTime(song.duration)}\``)
			.setThumbnail(song.thumbnail);
		await interaction.reply({ embeds: [embed] });
	} else if (commandName === "seek") {
		if (!getVoiceConnection(guildId)) {
			await interaction.reply("Je dois être dans un salon vocal !");
			return;
		}
		if (!client.queue.get(guildId).playing.id) {
			await interaction.reply("Aucun morceau n'est joué !");
			return;
		}
		const seconds = interaction.options.getInteger("position", true);
		if (seconds > client.queue.get(guildId).playing.duration) {
			await interaction.reply("La durée doit être inférieure à " + client.queue.get(guildId).playing.duration + " secondes !");
			return;
		}
		const stream = await PlayDl.stream(client.queue.get(guildId).playing.id, { seek: seconds });
		const resource = createAudioResource(stream.stream, {
			inputType: stream.type,
		});
		client.queue.get(guildId).player.play(resource);
		client.queue.get(guildId).playBegin = Math.floor(Date.now() / 1000) - seconds;
		await interaction.reply("⏯ Positionné à `" + durationToTime(seconds) + "` !");
	}
});

client.on("playUpdate", async (guildId: string) => {
	const { player, playing, loopQueue } = client.queue.get(guildId);
	if (playing.id) {
		try {
			const stream = await PlayDl.stream(playing.id);
			const resource = createAudioResource(stream.stream, {
				inputType: stream.type,
			});
			player.play(resource);
			getVoiceConnection(guildId).subscribe(player);
			client.queue.get(guildId).playBegin = Math.floor(Date.now() / 1000);
		} catch (e) {
			await (client.channels.cache.get(client.queue.get(guildId).channel) as TextChannel).send({
				embeds: [generateErrorEmbed("\u200b").setDescription(`Une erreur est survenue lors de la lecture de la musique : [${playing.title}](${playing.url})\n${e}`)],
			});
			if (client.queue.get(guildId).queue.length > 0) {
				if (loopQueue) {
					client.queue.get(guildId).queue.push(playing as { id: string; duration: number });
				}
				const play = client.queue.get(guildId).queue.shift();
				client.queue.set(guildId, {
					player: player,
					playBegin: Math.floor(Date.now() / 1000),
					playing: play,
					queue: client.queue.get(guildId).queue,
					channel: client.queue.get(guildId).channel,
					paused: false,
					musicTimePaused: 0
				});
				client.emit("playUpdate", guildId);
			} else {
				client.queue.set(guildId, {
					playBegin: undefined,
					playing: {},
					queue: [],
					channel: client.queue.get(guildId).channel,
					paused: false,
					musicTimePaused: 0
				});
				player?.removeAllListeners();
			}
			client.emit("playUpdate", guildId);
		}
	} else {
		player?.removeAllListeners();
		player?.stop();
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
