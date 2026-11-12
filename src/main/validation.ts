/**
 * Валидация входа из renderer. Вынесено из ipc-handlers, чтобы можно было
 * покрыть тестами: модуль с ipcMain тянет electron и в тестах не грузится.
 */
export function validateDate(dateStr: string): void {
  const regex = /^\d{4}-\d{2}-\d{2}$/
  if (!regex.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD.`)
  }

  // Формат мало что значит: «2026-13-99» проходил regex и падал RangeError
  // уже внутри localDayBounds, то есть непонятной ошибкой IPC.
  const [year, month, day] = dateStr.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`Invalid date: ${dateStr}. No such calendar day.`)
  }
}
