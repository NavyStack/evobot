import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { bot } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";

export default {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription(i18n.__("move.description"))
    .addIntegerOption((option) =>
      option.setName("movefrom").setDescription(i18n.__("move.args.movefrom")).setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("moveto").setDescription(i18n.__("move.args.moveto")).setRequired(true)
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    const movefromArg = interaction.options.getInteger("movefrom");
    const movetoArg = interaction.options.getInteger("moveto");

    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);
    const queue = bot.queues.get(interaction.guild!.id);

    if (!queue) {
      return interaction.reply(i18n.__("move.errorNotQueue")).catch(console.error);
    }

    if (!canModifyQueue(guildMember!)) return;

    // Validate arguments
    if (
      !movefromArg ||
      !movetoArg ||
      movefromArg < 1 ||
      movefromArg > queue.songs.length ||
      movetoArg < 1 ||
      movetoArg > queue.songs.length
    ) {
      return interaction.reply({
        content: i18n.__mf("move.usagesReply", { prefix: bot.prefix }),
        ephemeral: true
      });
    }

    const [removedSong] = queue.songs.splice(movefromArg - 1, 1);
    const targetIndex = Math.min(movetoArg - 1, queue.songs.length);

    queue.songs.splice(targetIndex, 0, removedSong);

    interaction.reply({
      content: i18n.__mf("move.result", {
        author: interaction.user.id,
        title: removedSong.title,
        index: targetIndex + 1
      })
    });
  }
};
