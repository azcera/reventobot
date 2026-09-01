const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // Рекомендуется добавить таймаут простоя, чтобы пул сам чистил старые коннекты:
    idleTimeoutMillis: 30000,
});

// 🔥 ОБЯЗАТЕЛЬНО: Перехватываем ошибки пула, чтобы приложение не падало
// именно из-за отсутствия этой строки Node.js завершал работу при команде от БД
pool.on("error", (err) => {
    console.error(
        "Непредвиденная ошибка на незанятом клиенте PostgreSQL:",
        err,
    );
});

// Безопасная проверка подключения через одноразовый запрос
pool.query("SELECT NOW()")
    .then(() => console.log("Успешное подключение к пулу PostgreSQL"))
    .catch((err) => console.error("Ошибка подключения к пулу БД:", err));

// Централизованная инициализация всех таблиц проекта
const initDb = async () => {
    try {
        // Используем pool.query напрямую — пул сам возьмет клиента и сразу вернет его обратно
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
