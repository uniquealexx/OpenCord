export function shouldHideWindowOnClose(quitting: boolean, updateInstalling: boolean): boolean {
  return !quitting && !updateInstalling;
}
