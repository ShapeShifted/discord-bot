const Database = require('better-sqlite3');
const db = new Database('sessions.db');

// Initialize Tables
db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard (
        user_id TEXT,
        session_type TEXT,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, session_type)
    );
    CREATE TABLE IF NOT EXISTS active_sessions (
        channel_id TEXT PRIMARY KEY,
        creator_id TEXT,
        session_type TEXT,
        origin_msg_id TEXT,  
    origin_channel_id TEXT
    );
    CREATE TABLE IF NOT EXISTS counters (
        session_type TEXT PRIMARY KEY,
        last_num INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS session_participants (
        channel_id TEXT,
        user_id TEXT,
        PRIMARY KEY (channel_id, user_id)
    );
`);

module.exports = {
    // Increments the specific score type for a user
    addUserScore: (userId, sessionType) => {
        const stmt = db.prepare(`
            INSERT INTO leaderboard (user_id, session_type, count) 
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, session_type) 
            DO UPDATE SET count = count + 1
        `);
        stmt.run(userId, sessionType);
    },

    saveSession: (channelId, creatorId, sessionType, origin_msg_id, origin_channel_id) => {
        const stmt = db.prepare('INSERT INTO active_sessions (channel_id, creator_id, session_type, origin_msg_id, origin_channel_id) VALUES (?, ?, ?, ?, ?)');
        stmt.run(channelId, creatorId, sessionType, origin_msg_id, origin_channel_id);
    },

    getSession: (channelId) => {
        return db.prepare('SELECT * FROM active_sessions WHERE channel_id = ?').get(channelId);
    },

    getNextSessionNumber: (sessionType) => {
        // Upsert to increment the count
        const update = db.prepare(`
            INSERT INTO counters (session_type, last_num) VALUES (?, 1)
            ON CONFLICT(session_type) DO UPDATE SET last_num = last_num + 1
        `).run(sessionType);
        
        // Return the newly updated number
        const result = db.prepare('SELECT last_num FROM counters WHERE session_type = ?').get(sessionType);
        return result.last_num;
    },

    deleteSession: (channelId) => {
        db.prepare('DELETE FROM active_sessions WHERE channel_id = ?').run(channelId);
        db.prepare('DELETE FROM session_participants WHERE channel_id = ?').run(channelId);
    },

    // Gets top 10 for a specific type (used for slash commands later)
    getTopTen: (sessionType) => {
    return db.prepare(`
        SELECT user_id, count 
        FROM leaderboard 
        WHERE session_type = ? 
        ORDER BY count DESC 
        LIMIT 10
    `).all(sessionType);
    },

        // Gets the total number of users with a score > 0 for a specific type
    getTotalCount: (sessionType) => {
        const result = db.prepare('SELECT COUNT(*) as total FROM leaderboard WHERE session_type = ? AND count > 0').get(sessionType);
        return result.total;
    },

    // Gets a specific page of 10 users
    getLeaderboardPage: (sessionType, limit, offset) => {
        return db.prepare(`
            SELECT user_id, count 
            FROM leaderboard 
            WHERE session_type = ? AND count > 0
            ORDER BY count DESC 
            LIMIT ? OFFSET ?
        `).all(sessionType, limit, offset);
    },

    // Checks if a user has already been recorded for this specific channel
    hasJoined: (channelId, userId) => {
        const row = db.prepare('SELECT 1 FROM session_participants WHERE channel_id = ? AND user_id = ?').get(channelId, userId);
        return !!row;
    },

    // Records that a user joined this specific channel
    recordParticipant: (channelId, userId) => {
        db.prepare('INSERT OR IGNORE INTO session_participants (channel_id, user_id) VALUES (?, ?)').run(channelId, userId);
    }
};