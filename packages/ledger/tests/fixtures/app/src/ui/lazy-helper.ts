export const lazy = (load: () => unknown) => () => load()
