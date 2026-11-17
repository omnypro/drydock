export function createHotContext(ownerPath: string): {
  on<T>(event: string, listener: (data: T) => void): void
}
