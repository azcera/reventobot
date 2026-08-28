function parseDateTime(inputString) {
  const dateTimeRegex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
  const timeOnlyRegex = /^(\d{2}):(\d{2})$/;

  // Важно: создаем дату с текущим часовым поясом системы
  let targetDate = new Date();

  if (dateTimeRegex.test(inputString)) {
    const [, day, month, year, hours, minutes] =
      inputString.match(dateTimeRegex);
    // Месяцы в JS: 0 = Январь, 11 = Декабрь
    targetDate = new Date(year, month - 1, day, hours, minutes);
  } else if (timeOnlyRegex.test(inputString)) {
    const [, hours, minutes] = inputString.match(timeOnlyRegex);
    // Явно задаем часы, минуты, секунды и миллисекунды для текущего дня
    targetDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  } else {
    return null;
  }

  return targetDate;
}

// Экспортируем как объект, чтобы работал импорт: const { parseDateTime } = require(...)
module.exports = { parseDateTime };
