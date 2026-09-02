const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
    console.error(
        "Непредвиденная ошибка на незанятом клиенте PostgreSQL:",
        err,
    );
});

pool.query("SELECT NOW()")
    .then(() => console.log("Успешное подключение к пулу PostgreSQL"))
    .catch((err) => console.error("Ошибка подключения к пулу БД:", err));

const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS family_applications (
                user_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                full_name TEXT NOT NULL,
                age INT NOT NULL,
                field3 TEXT,
                field4 TEXT,
                field5 TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS active_captures (
                message_id TEXT PRIMARY KEY,
                discord_timestamp TEXT,
                main_list JSONB,
                reserve_list JSONB,
                left_list JSONB,
                target TEXT,
                max_main INTEGER DEFAULT 20
            );
        `);

        console.log("Все таблицы БД успешно проверены и инициализированы.");
    } catch (err) {
        console.error("Критическая ошибка при инициализации таблиц БД:", err);
    }
};

initDb();

module.exports = pool;
