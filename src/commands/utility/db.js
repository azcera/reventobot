const { Client } = require("pg");

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

client
    .connect()
    .then(() => console.log("Успешное подключение к PostgreSQL"))
    .catch((err) => console.error("Ошибка подключения к БД:", err));

// Инициализация таблицы заявок
const initDb = async () => {
    const query = `
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
    `;
    await client.query(query);
};
initDb();

module.exports = client;
