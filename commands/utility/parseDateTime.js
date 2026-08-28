function parseDateTime(inputString) {
  const dateTimeRegex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
  const timeOnlyRegex = /^(\d{2}):(\d{2})$/;

  let year, month, day, hours, minutes;

  // 1. Если ввели полную дату и время
  if (dateTimeRegex.test(inputString)) {
    const [, dd, mm, yyyy, hh, min] = inputString.match(dateTimeRegex);
    year = yyyy;
    month = mm;
    day = dd;
    hours = hh;
    minutes = min;
  }
  // 2. Если ввели только время (подставляем сегодняшнюю дату по Москве)
  else if (timeOnlyRegex.test(inputString)) {
    const [, hh, min] = inputString.match(timeOnlyRegex);

    // Получаем текущую дату именно в Московском часовом поясе
    const mskDateStr = new Date().toLocaleDateString("ru-RU", {
      timeZone: "Europe/Moscow",
    }); // "ДД.ММ.ГГГГ"
    const [dd, mm, yyyy] = mskDateStr.split(".");

    year = yyyy;
    month = mm;
    day = dd;
    hours = hh;
    minutes = min;
  } else {
    return null;
  }

  // 3. Собираем строку в формате, который понимает конструктор Date,
  // и явно указываем смещение Москвы (+03:00)
  const isoString = `${year}-${month}-${day}T${hours}:${minutes}:00+03:00`;
  const targetDate = new Date(isoString);

  // Проверяем на валидность (например, если ввели 32 число или 25 часов)
  if (isNaN(targetDate.getTime())) {
    return null;
  }

  return targetDate;
}

function getDiscordTimestamp(parsedDate, offsetSeconds = 0) {
  const targetDate = new Date(parsedDate.getTime() + offsetSeconds * 1000);
  const timestamp = Math.floor(targetDate.getTime() / 1000);
  const today = new Date();
  const isToday =
    targetDate.toLocaleDateString() === today.toLocaleDateString();
  return `<t:${timestamp}:${isToday ? "t" : "F"}>`;
}

// Экспортируем как объект, чтобы работал импорт: const { parseDateTime } = require(...)
module.exports = { parseDateTime, getDiscordTimestamp };
