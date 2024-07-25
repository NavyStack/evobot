import { AudioResource, createAudioResource } from "@discordjs/voice";
import youtube from "youtube-sr";
import { i18n } from "../utils/i18n";
import { videoPattern, isURL } from "../utils/patterns";
import ytdl from "@distube/ytdl-core";
import { stream, video_basic_info } from "play-dl";

export interface SongData {
  url: string;
  title: string;
  duration: number;
}

export class Song {
  public readonly url: string;
  public readonly title: string;
  public readonly duration: number;

  public constructor({ url, title, duration }: SongData) {
    this.url = url;
    this.title = title;
    this.duration = duration;
  }

  public static async from(url: string = "", search: string = "") {
    const isYoutubeUrl = videoPattern.test(url);

    let songInfo;

    if (isYoutubeUrl) {
      songInfo = await video_basic_info(url);
      const videoDetails = songInfo?.video_details;

      if (!videoDetails) {
        throw new Error("No video details found");
      }

      return new this({
        url: videoDetails.url || "",
        title: videoDetails.title || "Unknown title",
        duration: parseInt(videoDetails.durationInSec?.toString() || "0")
      });
    } else {
      const result = await youtube.searchOne(search);

      if (!result) {
        console.log(`No results found for ${search}`);
        let err = new Error(`No search results found for ${search}`);
        err.name = "NoResults";

        if (isURL.test(url)) err.name = "InvalidURL";
        throw err;
      }

      songInfo = await video_basic_info(`https://youtube.com/watch?v=${result.id}`);
      const videoDetails = songInfo?.video_details;

      if (!videoDetails) {
        throw new Error("No video details found");
      }

      return new this({
        url: videoDetails.url || "",
        title: videoDetails.title || "Unknown title",
        duration: parseInt(videoDetails.durationInSec?.toString() || "0")
      });
    }
  }

  public async makeResource(): Promise<AudioResource<Song> | void> {
    let playStream;

    const source = this.url.includes("youtube") ? "youtube" : "soundcloud";

    if (source === "youtube") {
      // Use ytdl-core for YouTube
      playStream = ytdl(this.url, { filter: "audioonly", liveBuffer: 0, quality: "highestaudio" });
    } else {
      // Use play-dl for other sources
      const playDlStream = await stream(this.url);
      playStream = playDlStream.stream;
    }
    if (!stream) return;
    
    if (!playStream) throw new Error("No stream found");

    return createAudioResource(playStream, { metadata: this, inlineVolume: true });
  }

  public startMessage() {
    return i18n.__mf("play.startedPlaying", { title: this.title, url: this.url });
  }
}
