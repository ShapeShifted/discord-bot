const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const db = require('./database.js');
require('dotenv').config();
console.log("Testing .env load. Guild ID is:", process.env.GUILD_ID);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const ROLE_A_ID = process.env.ID_OF_JSP_ROLE; 
const ROLE_B_ID = process.env.ID_OF_SMALL_JSP_ROLE;
const CAT_A_ID = process.env.JSP_CAT_ID;
const CAT_B_ID = process.env.SMALL_JSP_CAT_ID;
const ARCHIVE_ID = process.env.ARCHIVE_CATEGORY_ID;

client.once('clientReady', async() => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);

    const guild = await client.guilds.fetch(process.env.GUILD_ID); // Ensure GUILD_ID is in your .env
    if (guild) {
        await client.application.commands.set([
            {
                name: 'leaderboard',
                description: 'View the support session leaderboard',
                options: [
                    {
                        name: 'type',
                        description: 'Which session type to view?',
                        type: 3, // 3 = STRING
                        required: true,
                        choices: [
                            { name: 'Jump Support', value: 'Jump Support' },
                            { name: 'Small Jump Support', value: 'Small Jump Support' }
                        ]
                    }
                ]
            }
        ]);
        console.log('🚀 Slash commands registered!');
    } else {
        console.log('❌ Guild not found. Check your GUILD_ID in .env');
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    let sessionType = null;
    let targetCategory = null;
    let namePrefix = ""; // FIXED: Declared with let

    if (message.mentions.roles.has(ROLE_A_ID)) {
        sessionType = 'Jump Support'; 
        targetCategory = CAT_A_ID;
        namePrefix = "jump-support-";
    } else if (message.mentions.roles.has(ROLE_B_ID)) {
        sessionType = 'Small Jump Support';
        targetCategory = CAT_B_ID;
        namePrefix = "small-jump-support-";
    }

    if (sessionType) {
        try {
            console.log(`Attempting to create session for ${sessionType}...`);
            const rawNum = db.getNextSessionNumber(sessionType);
            const sessionNum = String(rawNum).padStart(3, '0'); 
            const channelName = `${namePrefix}${sessionNum}`;

            const newChannel = await message.guild.channels.create({
                name: channelName,
                parent: targetCategory,
                permissionOverwrites: [
                    { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`join_${newChannel.id}`).setLabel('Join').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`leave_${newChannel.id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`end_${newChannel.id}`).setLabel('End Session').setStyle(ButtonStyle.Danger)
            );

            await newChannel.send({
                content: `## 🚀 New Session: ${channelName}\nStarted by <@${message.author.id}>. Use the buttons below to manage access.`,
                components: [buttons]
            });

            const OriginReply = await message.reply({
                content: `## 🚀 New Session: ${channelName}\nStarted by <@${message.author.id}>. Use the buttons below to manage access.`,
                components: [buttons] // Now buttons appear in the main chat too!
            });

            console.log("Saving session to database...");
            db.saveSession(newChannel.id, message.author.id, sessionType, OriginReply.id, message.channel.id);
        } catch (error) {
            console.error("Error creating session channel:", error);
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    // FIXED: Handle Slash Commands FIRST
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'leaderboard') {
            const type = interaction.options.getString('type');
            await sendLeaderboardPage(interaction, type, 0);
        }
        return;
    }

    // FIXED: Handle Buttons SECOND
    if (interaction.isButton()) {
        const { customId, user, member, guild } = interaction;

        // Leaderboard Pagination
        if (customId.startsWith('lb_')) {
            const [_, type, pageStr] = customId.split('_');
            const page = parseInt(pageStr);
            await sendLeaderboardPage(interaction, type, page);
            return;
        }

        const [action, targetId] = customId.split('_');
        const targetChannel = targetId ? await guild.channels.fetch(targetId) : interaction.channel;

        const session = db.getSession(targetChannel.id);
        if (!session) return interaction.reply({ content: '❌ Session not found or already closed.', flags: [MessageFlags.Ephemeral] }); 

        // --- JOIN ---
        if (action === 'join' || customId === 'session_join') {

            if (user.id === session.creator_id) {
                return interaction.reply({ 
                    content: '❌ You are the Host! You already have access to this session.', 
                    flags: [MessageFlags.Ephemeral] 
                });
            }

            await targetChannel.permissionOverwrites.create(user.id, { ViewChannel: true });
            db.addUserScore(user.id, session.session_type);
            
            // REMINDER: Notification in the session channel
            await targetChannel.send(`📥 **Join:** <@${user.id}> has entered the session.`);
            
            await interaction.reply({ content: `✅ Added to <#${targetChannel.id}>!`, flags: [MessageFlags.Ephemeral] });
        }

        // --- LEAVE ---
        if (action === 'leave') {
            if (user.id === session.creator_id) {
                return interaction.reply({ content: '⚠️ Hosts cannot leave. You must **End** the session.', flags: [MessageFlags.Ephemeral] });
            }
            await targetChannel.permissionOverwrites.delete(user.id);
            
            // REMINDER: Notification in the session channel
            await targetChannel.send(`📤 **Leave:** <@${user.id}> has left the session.`);
            
            await interaction.reply({ content: '👋 Left.', flags: [MessageFlags.Ephemeral] });
        }

        // --- END ---
        if (action === 'end' || customId === 'session_end') {
            const hasPerm = member.permissions.has(PermissionsBitField.Flags.ManageRoles);
            if (!hasPerm && user.id !== session.creator_id) {
                return interaction.reply({ content: '❌ No permission.', flags: [MessageFlags.Ephemeral] });
            }

            const disabledButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('disabled_join').setLabel('Join').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('disabled_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('disabled_end').setLabel('Session Ended').setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            await interaction.update({ components: [disabledButtons] });

            if (session.origin_msg_id && session.origin_channel_id) {
            try {
                const originChan = await guild.channels.fetch(session.origin_channel_id);
                const originMsg = await originChan.messages.fetch(session.origin_msg_id);
                await originMsg.edit({ components: [disabledButtons] });
            } catch (e) {
                console.log("Could not find or edit the original ping message!");
            }
        }

            await targetChannel.send(`🏁 **Session Ended** by <@${user.id}>. Moving to archive...`);
            
            setTimeout(async () => {
                try {
                    await targetChannel.setParent(ARCHIVE_ID, { lockPermissions: true });
                    db.deleteSession(targetChannel.id);
                } catch (e) { console.error(e); }
            }, 2000);
        }
    }
});

// Helper function (Keep this outside)
async function sendLeaderboardPage(interaction, type, page) {
    const limit = 10;
    const offset = page * limit;
    
    const data = db.getLeaderboardPage(type, limit, offset);
    const total = db.getTotalCount(type);
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
        const replyObj = { content: "No one has a score yet!", flags:[MessageFlags.Ephemeral] };
        return interaction.isButton() ? interaction.reply(replyObj) : interaction.reply(replyObj);
    }

    const description = data
        .map((row, index) => `**${offset + index + 1}.** <@${row.user_id}> — \`${row.count}\` sessions`)
        .join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`🏆 ${type} Leaderboard`)
        .setDescription(description)
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
        .setColor(0x00AE86);

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`lb_${type}_${page - 1}`)
            .setLabel('⬅️ Back')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`lb_${type}_${page + 1}`)
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page + 1 >= totalPages)
    );

    if (interaction.isButton()) {
        await interaction.update({ embeds: [embed], components: [buttons] });
    } else {
        await interaction.reply({ embeds: [embed], components: [buttons] });
    }
}

client.login(process.env.DISCORD_TOKEN);