import Discord, {
	Collection,
	GuildChannel,
	GuildMember,
	MessageEmbed,
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
import { URLSearchParams } from "url";
import ytdl from "ytdl-core";
import axios from "axios";

require("dotenv").config();
const youtubeRegex =
	/^(?:https?\:\/\/)?(?:www\.)?(?:(?:youtube\.com\/watch\?v=([A-Za-z0-9-]{11})(?:&.+)?)|(?:youtu\.be\/([A-Za-z0-9-]{11})))$/;

function resolveDuration(duration: string): number {
	duration = duration.slice(2);
	let time: number = 0;
	if (duration.split("H").length === 2) {
		time += parseInt(duration.split("H")[0]) * 3600;
		duration = duration.split("H")[1];
	}
	if (duration.split("M").length === 2) {
		time += parseInt(duration.split("M")[0]) * 60;
		duration = duration.split("M")[1];
	}
	if (duration.split("S").length === 2) {
		time += parseInt(duration.split("S")[0]);
		duration = duration.split("S")[1];
	}
	return time;
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
	if (Math.floor(duration / 60) > 0) {
		str +=
			(Math.floor(duration / 60) < 10
				? "0" + Math.floor(duration / 60)
				: Math.floor(duration / 60)) + ":";
		duration %= 60;
	}
	if (duration > 0) {
		str += duration < 10 ? "0" + duration : duration;
	}
	return str;
}

function resolveId(query: string): Promise<[string, number]> {
	return new Promise<[string, number]>(async (resolve, reject) => {
		let link: boolean = youtubeRegex.test(query);
		let id: string;
		if (!link) {
			const res = await axios.get(
			"https://www.googleapis.com/youtube/v3/search?" +
				new URLSearchParams({
					q: query,
					maxResults: "1",
					key: process.env.ytToken,
					type: "video",
					topicId: "/m/04rlf",
					safeSearch: "strict",
				})
			);
			id = res.data.items[0].id.videoId
		} else {
			id = youtubeRegex.exec(query)[1] ?? youtubeRegex.exec(query)[2]
		}
		const {
			data: {
				items: [
					{
						contentDetails: { duration },
					},
				],
			},
		} = await axios.get(
			"https://www.googleapis.com/youtube/v3/videos?" +
				new URLSearchParams({
					part: "contentDetails",
					id: id,
					key: process.env.ytToken,
				})
		);

		resolve([id, resolveDuration(duration)]);
	});
}

function registerPlayer(guildId: string): void {
	const player = client.queue.get(guildId).player;
	player.on(AudioPlayerStatus.Idle, () => {
		if (client.queue.get(guildId).queue.length > 0) {
			const playing = client.queue.get(guildId).queue.shift();
			client.queue.set(guildId, {
				player,
				playBegin: Math.floor(Date.now() / 1000),
				playing,
				queue: client.queue.get(guildId).queue,
			});
			client.emit("playUpdate", [guildId]);
		} else {
			client.queue.set(guildId, {
				playBegin: undefined,
				playing: {},
				queue: [],
			});
			player.removeAllListeners();
		}
	});
}

class Rythm extends Discord.Client {
	queue: Collection<
		Snowflake,
		{
			player?: AudioPlayer;
			playBegin?: number;
			playing: { id?: string; duration?: number };
			queue: { id: string; duration: number }[];
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

client.queue = new Collection();

client.once("ready", () => {
	console.log(`Logged in as ${client.user.tag} !`);

	client.guilds.cache
		.filter(({ id }) =>
			["497754200940347403", "691073500127035443"].includes(id)
		)
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
					name: "skip",
					description: "Skip une musique",
				},
				{
					name: "leave",
					description: "Quitte le salon",
				},
				{
					name: "queue",
					description: "Affiche la queue"
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
		let [id, duration] = await resolveId(query);
		let {
			videoDetails: {
				title,
				author: {
					thumbnails: [{ url: avatar }],
					name,
				},
				publishDate,
			},
		} = await ytdl.getBasicInfo(id);
		let videoEmbed: MessageEmbed;

		if (client.queue.get(interaction.guildId).playing.id) {
			videoEmbed = new MessageEmbed()
				.setTitle(
					`${
						(interaction.member as GuildMember).displayName
					} a ajouté une musique à la queue !`
				)
				.setThumbnail(`https://img.youtube.com/vi/${id}/hqdefault.jpg`)
				.addField("Titre", title, true)
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
								.queue.reduce((p, c) => p + c.duration, 0) || 0)
					)
				)
				.setFooter("Mise en ligne : " + publishDate, avatar);
			client.queue
				.get(interaction.guildId)
				.queue.push({ id: id, duration: duration });
		} else {
			videoEmbed = new MessageEmbed()
				.setTitle(
					`${
						(interaction.member as GuildMember).displayName
					} a ajouté une musique à la queue !`
				)
				.setThumbnail(`https://img.youtube.com/vi/${id}/hqdefault.jpg`)
				.addField("Titre", title, true)
				.addField("Auteur", name, true)
				.addField("Durée", durationToTime(duration), true)
				.setFooter("Mise en ligne : " + publishDate, avatar);
			client.queue.set(interaction.guildId, {
				player: createAudioPlayer(),
				playBegin: Math.floor(Date.now() / 1000),
				playing: { id: id, duration: duration },
				queue: [],
			});

			client.emit("playUpdate", 
				interaction.guildId
			);
			registerPlayer(interaction.guildId);
		}

		await interaction.reply({ embeds: [videoEmbed] });
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
		client.queue.set(interaction.guildId, {
			player: client.queue.get(interaction.guildId).player,
			playing: playing,
			queue: client.queue.get(interaction.guildId).queue,
			playBegin: Math.floor(Date.now() / 1000),
		});
		client.emit('playUpdate', interaction.guildId);
		await interaction.reply("Skipped");
	} else if (interaction.commandName === 'queue') {
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
			...client.queue.get(interaction.guildId).queue.map(s => s.id),
		];
	}
});

client.on("playUpdate", (guildId: string) => {
	const {
		player,
		playing: { id },
	} = client.queue.get(guildId);
	if (id) {
		const resource = createAudioResource(
			ytdl(id, {
				filter: "audioonly",
				quality: "highestaudio",
			}),
			{
				inputType: StreamType.Arbitrary,
			}
		);
		player.play(resource);
		getVoiceConnection(guildId).subscribe(player);
	} else {
		player.removeAllListeners();
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
