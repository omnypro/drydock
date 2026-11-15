export function createHotContext(ownerPath: string): {
  on(event: string, listener: (data: any) => void): void
}
