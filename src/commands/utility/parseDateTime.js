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

  const isoString = `${year}-${month}-${day}T${hours}:${minutes}:00+03:00`;
  const targetDate = new Date(isoString);

  // Проверяем на валидность (например, если ввели 32 число или 25 часов)
  if (isNaN(targetDate.getTime())) {
    return null;
  }

  return targetDate;
}

// НОВАЯ ФУНКЦИЯ ВМЕСТО getDiscordTimestamp
function getMskTimeString(parsedDate, offsetSeconds = 0) {
  // Высчитываем дату с учетом сдвига
  const targetDate = new Date(parsedDate.getTime() + offsetSeconds * 1000);

  // Форматируем строго в часовой пояс Москвы, выводя только часы и минуты
  return targetDate.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDiscordTimestamp(parsedDate) {
  if (!parsedDate || isNaN(parsedDate.getTime())) return "Неизвестное время";

  // 1. Создаем объект даты, который представляет введенное время в UTC формате
  const utcYear = parsedDate.getFullYear();
  const utcMonth = parsedDate.getMonth();
  const utcDay = parsedDate.getDate();
  const utcHours = parsedDate.getHours();
  const utcMinutes = parsedDate.getMinutes();

  const mskUtcTimestamp = Date.UTC(
    utcYear,
    utcMonth,
    utcDay,
    utcHours,
    utcMinutes,
  );

  // 3. Вычитаем 3 часа (3 * 60 * 60 * 1000 мс), чтобы перевести МСК обратно в чистый UTC для Discord
  const finalTimestampSeconds = Math.floor(
    (mskUtcTimestamp - 3 * 60 * 60 * 1000) / 1000,
  );

  // Возвращаем короткий формат времени Discord (например, "18:30")
  return `<t:${finalTimestampSeconds}:t>`;
}

module.exports = { parseDateTime, getMskTimeString, getDiscordTimestamp };
