import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export const resources = {
  ko: {
    translation: {
      hello: '안녕하세요',
      search: '검색',
      chat: '챗',
      search_placeholder: '검색어를 입력'
    }
  },
  en: {
    translation: {
      hello: 'Hello',
      search: 'Search',
      chat: 'Chat',
      search_placeholder: 'Type to search'
    }
  }
} as const;

export function ensureI18n() {
  if (!i18next.isInitialized) {
    i18next
      .use(initReactI18next)
      .init({
        resources,
        lng: 'ko',
        fallbackLng: 'en',
        interpolation: { escapeValue: false }
      })
      .catch(() => undefined);
  }
}


