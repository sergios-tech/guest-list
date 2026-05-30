import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import sr from './locales/sr.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, sr: { translation: sr } },
    // No explicit `lng`: let LanguageDetector restore the cached choice from
    // localStorage; `fallbackLng` covers the first visit (Serbian default).
    fallbackLng: 'sr',
    supportedLngs: ['en', 'sr'],
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage'], caches: ['localStorage'] },
  });

// Keep <html lang> in sync with the active language so the declared page
// language matches what is rendered (screen-reader pronunciation, SEO). The
// detector can now boot the app in either language, so this can't be left
// hardcoded in index.html.
const syncDocumentLang = (lng: string) => {
  document.documentElement.lang = lng.split('-')[0];
};
syncDocumentLang(i18n.language);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
