/**
 * Uvítání po první instalaci: otevře se stránka nastavení s oznámením, že počty dislajků načítá
 * služba Return YouTube Dislike (dostane ID videa, server vidí IP adresu), a s možností modul vypnout.
 * Aktualizace doplňku ani prohlížeče nic neotevírají a nic nevypínají.
 */
export const WELCOME_PARAM = 'welcome';
export const WELCOME_PATH = `options/options.html?${WELCOME_PARAM}=1#dislikes`;

/** Jen opravdu nová instalace (reason 'install'), ne 'update' ani 'chrome_update'. */
export const isFirstInstall = (details) => details?.reason === 'install';

/** Byla stránka nastavení otevřená z uvítání? search = location.search */
export const isWelcomeSearch = (search) => new URLSearchParams(search ?? '').get(WELCOME_PARAM) === '1';
