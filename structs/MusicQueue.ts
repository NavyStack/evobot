import {
  AudioPlayer,
  AudioPlayerPlayingState,
  AudioPlayerState,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  entersState,
  NoSubscriberBehavior,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionState,
  VoiceConnectionStatus
} from "@discordjs/voice";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  GuildMember,
  Interaction,
  Message,
  TextChannel
} from "discord.js";
import { promisify } from "node:util";
import { bot } from "../index";
import { QueueOptions } from "../interfaces/QueueOptions";
import { config } from "../utils/config";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { Song } from "./Song";
import { safeReply } from "../utils/safeReply";

const wait = promisify(setTimeout);

const BUTTONS = {
  SKIP: "skip",
  PLAY_PAUSE: "play_pause",
  MUTE: "mute",
  DECREASE_VOLUME: "decrease_volume",
  INCREASE_VOLUME: "increase_volume",
  LOOP: "loop",
  SHUFFLE: "shuffle",
  STOP: "stop"
};

export class MusicQueue {
  public readonly interaction: CommandInteraction;
  public readonly connection: VoiceConnection;
  public readonly player: AudioPlayer;
  public readonly textChannel: TextChannel;
  public readonly bot = bot;

  public resource: AudioResource;
  public songs: Song[] = [];
  public volume = config.DEFAULT_VOLUME || 100;
  public loop = false;
  public muted = false;
  public waitTimeout: NodeJS.Timeout | undefined;
  private queueLock = false;
  private readyLock = false;
  private stopped = false;

  public constructor(options: QueueOptions) {
    Object.assign(this, options);

    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.connection.subscribe(this.player);

    this.connection.on("stateChange", async (oldState, newState) => {
      const networkStateChangeHandler = (oldNetworkState, newNetworkState) => {
        const newUdp = Reflect.get(newNetworkState, "udp");
        clearInterval(newUdp?.keepAliveInterval);
      };

      Reflect.get(oldState, "networking")?.off("stateChange", networkStateChangeHandler);
      Reflect.get(newState, "networking")?.on("stateChange", networkStateChangeHandler);

      if (newState.status === VoiceConnectionStatus.Disconnected) {
        if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
          try {
            this.stop();
          } catch (e) {
            console.log(e);
            this.stop();
          }
        } else if (this.connection.rejoinAttempts < 5) {
          await wait((this.connection.rejoinAttempts + 1) * 5000);
          this.connection.rejoin();
        } else {
          this.connection.destroy();
        }
      } else if (!this.readyLock && [VoiceConnectionStatus.Connecting, VoiceConnectionStatus.Signalling].includes(newState.status)) {
        this.readyLock = true;
        try {
          await entersState(this.connection, VoiceConnectionStatus.Ready, 20000);
        } catch {
          if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
              this.connection.destroy();
            } catch {}
          }
        } finally {
          this.readyLock = false;
        }
      }
    });

    this.player.on("stateChange", async (oldState, newState) => {
      if (oldState.status !== AudioPlayerStatus.Idle && newState.status === AudioPlayerStatus.Idle) {
        if (this.loop && this.songs.length) {
          this.songs.push(this.songs.shift()!);
        } else {
          this.songs.shift();
          if (!this.songs.length) return this.stop();
        }
        if (this.songs.length || this.resource.audioPlayer) this.processQueue();
      } else if (oldState.status === AudioPlayerStatus.Buffering && newState.status === AudioPlayerStatus.Playing) {
        this.sendPlayingMessage(newState);
      }
    });

    this.player.on("error", async (error) => {
      console.error(error);
      if (this.loop && this.songs.length) {
        this.songs.push(this.songs.shift()!);
      } else {
        this.songs.shift();
      }
      this.processQueue();
    });
  }

  public enqueue(...songs: Song[]) {
    if (this.waitTimeout) clearTimeout(this.waitTimeout);
    this.waitTimeout = undefined;
    this.stopped = false;
    this.songs = [...this.songs, ...songs];
    this.processQueue();
  }

  public stop() {
    if (this.stopped) return;

    this.stopped = true;
    this.loop = false;
    this.songs = [];
    this.player.stop();

    if (!config.PRUNING) {
      this.textChannel.send(i18n.__("play.queueEnded")).catch(console.error);
    }

    if (!this.waitTimeout) {
      this.waitTimeout = setTimeout(() => {
        if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try {
            this.connection.destroy();
          } catch {}
        }
        bot.queues.delete(this.interaction.guild!.id);
        if (!config.PRUNING) {
          this.textChannel.send(i18n.__("play.leaveChannel"));
        }
      }, config.STAY_TIME * 1000);
    }
  }

  public async processQueue(): Promise<void> {
    if (this.queueLock || this.player.state.status !== AudioPlayerStatus.Idle) {
      return;
    }

    if (!this.songs.length) {
      return this.stop();
    }

    this.queueLock = true;
    const next = this.songs[0];

    try {
      const resource = await next.makeResource();
      this.resource = resource!;
      this.player.play(this.resource);
      this.resource.volume?.setVolumeLogarithmic(this.volume / 100);
    } catch (error) {
      console.error(error);
      this.processQueue();
    } finally {
      this.queueLock = false;
    }
  }

  private async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const handler = this.commandHandlers.get(interaction.customId);
    if (handler) {
      try {
        await interaction.deferUpdate();
        await handler.call(this, interaction);
      } catch (error) {
        console.error(error);
        if (!interaction.replied) {
          await safeReply(interaction, i18n.__("error.generic"));
        }
      }
    }
  }

  private commandHandlers = new Map<string, (interaction: ButtonInteraction) => Promise<void>>([
    [BUTTONS.SKIP, this.handleSkip],
    [BUTTONS.PLAY_PAUSE, this.handlePlayPause],
    [BUTTONS.MUTE, this.handleMute],
    [BUTTONS.DECREASE_VOLUME, this.handleDecreaseVolume],
    [BUTTONS.INCREASE_VOLUME, this.handleIncreaseVolume],
    [BUTTONS.LOOP, this.handleLoop],
    [BUTTONS.SHUFFLE, this.handleShuffle],
    [BUTTONS.STOP, this.handleStop]
  ]);

  private createButtonRow() {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(BUTTONS.SKIP).setLabel("⏭").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTONS.PLAY_PAUSE).setLabel("⏯").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTONS.MUTE).setLabel("🔇").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTONS.DECREASE_VOLUME).setLabel("🔉").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTONS.INCREASE_VOLUME).setLabel("🔊").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(BUTTONS.LOOP).setLabel("🔁").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTONS.SHUFFLE).setLabel("🔀").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTONS.STOP).setLabel("⏹").setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  private async sendPlayingMessage(newState: AudioPlayerPlayingState) {
    const song = (newState.resource as AudioResource<Song>).metadata;

    let playingMessage: Message;

    try {
      playingMessage = await this.textChannel.send({
        content: song.startMessage(),
        components: this.createButtonRow()
      });
    } catch (error) {
      console.error(error);
      if (error instanceof Error) this.textChannel.send(error.message);
      return;
    }

    const filter = (i: Interaction) => i.isButton() && i.message.id === playingMessage.id;
    const collector = playingMessage.createMessageComponentCollector({
      filter,
      time: song.duration > 0 ? song.duration * 1000 : 60000
    });

    collector.on("collect", async (interaction) => {
      if (!interaction.isButton()) return;
      await this.handleInteraction(interaction);
      if ([BUTTONS.SKIP, BUTTONS.STOP].includes(interaction.customId)) collector.stop();
    });

    collector.on("end", () => {
      playingMessage.edit({ components: [] }).catch(console.error);
      if (config.PRUNING) {
        setTimeout(() => {
          playingMessage.delete().catch();
        }, 3000);
      }
    });
  }
}
