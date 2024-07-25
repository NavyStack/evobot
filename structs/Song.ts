import { AudioResource, createAudioResource } from "@discordjs/voice";
import youtube from "youtube-sr";
import { i18n } from "../utils/i18n";
import { videoPattern } from "../utils/patterns";
import ytdl from "@distube/ytdl-core";
import { stream, video_basic_info } from "play-dl";

// Interface defining the structure for song data
export interface SongData {
  url: string; // URL of the song
  title: string; // Title of the song
  duration: number; // Duration of the song in seconds
}

// Class representing a song
export class Song {
  public readonly url: string; // URL of the song
  public readonly title: string; // Title of the song
  public readonly duration: number; // Duration of the song in seconds

  // Constructor to initialise a new Song instance
  public constructor({ url, title, duration }: SongData) {
    this.url = url;
    this.title = title;
    this.duration = duration;
  }

  /**
   * Static method to create a Song instance from a URL or search term.
   *
   * @param url - The URL of the song. If provided, this will be used to fetch song details.
   * @param search - The search term to find a song if no URL is provided.
   * @returns A Promise that resolves to a Song instance.
   */
  public static async from(url: string = "", search: string = ""): Promise<Song> {
    try {
      // Determine if the provided URL is a valid YouTube URL
      const isYoutubeUrl = videoPattern.test(url);
      // Fetch song information based on whether the URL is a YouTube link or a search term
      const songInfo = isYoutubeUrl ? await Song.fetchSongInfoFromUrl(url) : await Song.fetchSongInfoFromSearch(search);

      // Extract video details from the fetched song information
      const videoDetails = songInfo?.video_details;

      // If video details are not available, throw an error
      if (!videoDetails) {
        throw new Error("No video details found");
      }

      // Return a new Song instance with the retrieved details
      return new this({
        url: videoDetails.url || "",
        title: videoDetails.title || "Unknown title",
        duration: parseInt(videoDetails.durationInSec?.toString() || "0", 10)
      });
    } catch (error) {
      console.error("Error in creating song instance:", error);
      throw new Error("Unable to fetch song information.");
    }
  }

  /**
   * Fetch song information from the provided URL using the play-dl library.
   *
   * @param url - The URL of the song.
   * @returns A Promise that resolves to the song information.
   */
  private static async fetchSongInfoFromUrl(url: string) {
    try {
      // Retrieve basic video information using play-dl's video_basic_info function
      return await video_basic_info(url);
    } catch (error) {
      console.error(`Error fetching song info from URL ${url}:`, error);
      throw new Error("Unable to fetch song information from URL.");
    }
  }

  /**
   * Fetch song information based on a search term using the youtube-sr library.
   *
   * @param search - The search term to find the song.
   * @returns A Promise that resolves to the song information.
   */
  private static async fetchSongInfoFromSearch(search: string) {
    try {
      // Search for a song on YouTube using the provided search term
      const result = await youtube.searchOne(search);

      // If no results are found, throw an error
      if (!result) {
        throw new Error(`No results found for ${search}`);
      }

      // Fetch detailed information for the first search result
      return await Song.fetchSongInfoFromUrl(`https://youtube.com/watch?v=${result.id}`);
    } catch (error) {
      console.error(`Error fetching song info from search "${search}":`, error);
      throw new Error("Unable to fetch song information from search.");
    }
  }

  /**
   * Create an audio resource for the song.
   *
   * @returns A Promise that resolves to an AudioResource instance, or undefined if an error occurs.
   */
  public async makeResource(): Promise<AudioResource<Song> | undefined> {
    try {
      // Determine the appropriate stream based on the URL
      const playStream = this.url.includes("youtube")
        ? ytdl(this.url, {
            filter: "audioonly",
            liveBuffer: 0,
            highWaterMark: 1 << 25, // Set high water mark to handle large streams
            quality: "highestaudio" // Request the highest quality audio
          })
        : await this.createPlayDlStream();

      // If the stream could not be created, throw an error
      if (!playStream) {
        throw new Error("Failed to create audio stream");
      }

      // Create and return an AudioResource instance with the stream and metadata
      return createAudioResource(playStream, { metadata: this, inlineVolume: true });
    } catch (error) {
      console.error("Error in creating audio resource:", error);
      return undefined;
    }
  }

  /**
   * Create a stream using the play-dl library for non-YouTube URLs.
   *
   * @returns A Promise that resolves to a readable stream for the song.
   */
  private async createPlayDlStream() {
    try {
      // Retrieve the stream using play-dl's stream function
      const { stream: playDlStream } = await stream(this.url);
      return playDlStream;
    } catch (error) {
      console.error(`Error creating play-dl stream for URL ${this.url}:`, error);
      throw new Error("Unable to create play-dl stream.");
    }
  }

  /**
   * Generate a message indicating that playback has started for this song.
   *
   * @returns A message string for notifying that playback has started.
   */
  public startMessage(): string {
    return i18n.__mf("play.startedPlaying", { title: this.title, url: this.url });
  }
}
