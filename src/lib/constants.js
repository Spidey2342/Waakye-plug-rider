/**
 * Platform constants and configuration values.
 */

/**
 * Support WhatsApp number (country code, no + or spaces).
 * Falls back to a documented placeholder if the env var is missing.
 */
/** Browser tab, home-screen, and in-app logo (`public/favicon-rider.png`). */
export const APP_ICON_SRC = '/favicon-rider.png';

export const SUPPORT_WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_WHATSAPP || '233599995651';
